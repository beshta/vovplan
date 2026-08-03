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
import { rateLimit, rateLimitReset } from '../../utils/rateLimit.js';

const updateProfileSchema = z.object({
  displayName: z.string().min(2, 'Имя должно быть не короче 2 символов').max(60).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z.string().min(8, 'Новый пароль должен быть не короче 8 символов'),
});

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export default async function authRoutes(fastify: FastifyInstance) {

  // ── POST /api/auth/register ───────────────
  fastify.post('/register', async (request, reply) => {
    rateLimit(request, 'register', 5, 15 * 60_000);

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
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    // Generate JWT
    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email });

    return reply.code(201).send({ user, accessToken });
  });

  // ── POST /api/auth/login ──────────────────
  fastify.post('/login', async (request, reply) => {
    // Без ограничения пароль можно подбирать бесконечно
    rateLimit(request, 'login', 10, 5 * 60_000);

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, password } = parsed.data;

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

    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email });
    rateLimitReset(request, 'login');

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
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

    return reply.send(user);
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

    return reply.send(user);
  });

  // ── POST /api/auth/password — смена пароля ──
  fastify.post('/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // Здесь проверяется текущий пароль — тоже поддаётся подбору
    rateLimit(request, 'password', 10, 5 * 60_000);

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

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });

    return reply.send({ ok: true });
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

    return reply.send(user);
  });
}
