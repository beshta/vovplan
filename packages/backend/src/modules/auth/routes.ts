import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { registerSchema, loginSchema } from '@vovplan/shared';
import prisma from '../../db/prisma.js';
import {
  rateLimit,
  rateLimitReset,
  rateLimitAccount,
  rateLimitAccountReset,
} from '../../utils/rateLimit.js';
import { signUploadUrl } from '../../utils/signedUrl.js';

const updateProfileSchema = z.object({
  displayName: z.string().min(2, 'Имя должно быть не короче 2 символов').max(60).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z.string().min(8, 'Новый пароль должен быть не короче 8 символов'),
});

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Профиль наружу: аватар уходит подписанной ссылкой, как и любой файл */
function toUserDTO<T extends { avatarUrl: string | null }>(user: T) {
  return { ...user, avatarUrl: signUploadUrl(user.avatarUrl) };
}

export default async function authRoutes(fastify: FastifyInstance) {

  // ── POST /api/auth/register ───────────────
  fastify.post('/register', async (request, reply) => {
    /*
     * Порог поднят с пяти намеренно. Счёт идёт по адресу источника, а за
     * обратным прокси он один на всех — прежние пять означали, что во всём
     * сервисе может зарегистрироваться пять человек за пятнадцать минут, и
     * один желающий закрывал регистрацию совсем.
     *
     * От массовой накрутки учёток адрес всё равно не защищает. Это делает
     * подтверждение почты, которого пока нет.
     */
    rateLimit(request, 'register', 60, 15 * 60_000);

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, password, displayName } = parsed.data;

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({
        error: 'CONFLICT',
        message: 'Пользователь с таким email уже существует',
        statusCode: 409,
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
      select: {
        id: true, email: true, displayName: true, avatarUrl: true, createdAt: true,
        tokenVersion: true,
      },
    });

    // Поколение токена вшивается в него: хук сверит его с базой на каждом запросе
    const accessToken = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      ver: user.tokenVersion,
    });

    const { tokenVersion: _ignored, ...safeUser } = user;
    return reply.code(201).send({ user: toUserDTO(safeUser), accessToken });
  });

  // ── POST /api/auth/login ──────────────────
  fastify.post('/login', async (request, reply) => {
    /*
     * Два счётчика, и главный из них — второй.
     *
     * По адресу источника считать почти бесполезно: за обратным прокси все
     * запросы приходят с одного адреса, и лимит становится общим на всех.
     * Раньше он был единственным и стоял на десяти попытках — то есть любой
     * желающий десятью неудачными входами закрывал вход всему сервису на пять
     * минут. Здесь порог щедрый, это защита от потока, а не от подбора.
     *
     * Подбор пароля останавливает счётчик по учётной записи: он не зависит ни
     * от прокси, ни от числа адресов у злоумышленника.
     */
    rateLimit(request, 'login', 60, 5 * 60_000);

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, password } = parsed.data;
    rateLimitAccount('login', email, 8, 15 * 60_000);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверный email или пароль',
        statusCode: 401,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверный email или пароль',
        statusCode: 401,
      });
    }

    const accessToken = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      ver: user.tokenVersion,
    });
    // Успешный вход снимает подозрения с обоих счётчиков
    rateLimitReset(request, 'login');
    rateLimitAccountReset('login', email);

    return reply.send({
      user: toUserDTO({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      }),
      accessToken,
    });
  });

  // ── GET /api/auth/me ──────────────────────
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден', statusCode: 404 });
    }

    return reply.send(toUserDTO(user));
  });

  // ── PATCH /api/auth/me — настройки профиля ──
  fastify.patch('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: parsed.data,
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    return reply.send(toUserDTO(user));
  });

  // ── POST /api/auth/password — смена пароля ──
  fastify.post('/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // Здесь проверяется текущий пароль — тоже поддаётся подбору. Считаем по
    // самому пользователю: он уже известен из токена, и это точнее адреса
    rateLimitAccount('password', request.user.userId, 10, 15 * 60_000);

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: request.user.userId } });
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден', statusCode: 404 });
    }

    // Текущий пароль обязателен — иначе угнанная сессия меняет пароль молча
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.code(400).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Текущий пароль неверен',
        statusCode: 400,
      });
    }

    /*
     * Смена пароля выгоняет все прежние сессии.
     *
     * Ради этого поколение и заводилось: пароль меняют чаще всего именно
     * потому, что подозревают чужой доступ, — а прежний токен без отзыва
     * работал бы ещё неделю, и смена пароля угонщику не мешала.
     *
     * Текущей вкладке сразу выдаётся токен нового поколения, иначе человек
     * выгонял бы заодно и себя.
     */
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        tokenVersion: { increment: 1 },
      },
      select: { id: true, email: true, tokenVersion: true },
    });

    const accessToken = fastify.jwt.sign({
      userId: updated.id,
      email: updated.email,
      ver: updated.tokenVersion,
    });

    return reply.send({ ok: true, accessToken });
  });

  // ── POST /api/auth/avatar — загрузка аватара ──
  fastify.post('/avatar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Файл не загружен', statusCode: 400 });
    }

    if (!AVATAR_TYPES.includes(data.mimetype)) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: `Неподдерживаемый формат: ${data.mimetype}. Разрешены PNG, JPEG, WebP`,
        statusCode: 400,
      });
    }

    // Приводим к квадрату 256×256 webp — аватар не должен тащить мегабайты
    const buf = await data.toBuffer();
    const webp = await sharp(buf).resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();

    const dir = join(process.cwd(), 'uploads', 'avatars');
    mkdirSync(dir, { recursive: true });
    const filename = `${request.user.userId}-${randomUUID()}.webp`;
    await writeFile(join(dir, filename), webp);

    const avatarUrl = `/uploads/avatars/${filename}`;
    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: { avatarUrl },
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    return reply.send(toUserDTO(user));
  });
}
