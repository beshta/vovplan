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
import { normalizeEmail, findUserByEmail } from '../../utils/email.js';
import {
  issueEmailToken,
  claimEmailToken,
  VERIFY_TTL_MS,
  RESET_TTL_MS,
} from '../../utils/emailToken.js';
import { sendMail, verifyEmailLetter, resetPasswordLetter } from '../../utils/mail.js';
import { IMAGE_LIMIT } from '../../utils/uploadLimits.js';

const updateProfileSchema = z.object({
  displayName: z.string().min(2, 'Имя должно быть не короче 2 символов').max(60).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z.string().min(8, 'Новый пароль должен быть не короче 8 символов'),
});

const forgotSchema = z.object({
  email: z.string().email('Некорректный email'),
});

const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
});

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Что отдаём как профиль. Один список на все четыре маршрута: расходящиеся
 * наборы полей означали бы, что после смены аватара из ответа тихо пропадает
 * что-нибудь, что было при входе.
 *
 * `isAdmin` здесь для того, чтобы интерфейс знал, показывать ли вход в
 * админку. Секрета в нём нет: свой собственный признак человек и так узнает,
 * постучавшись по адресу панели.
 */
const PROFILE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
  emailVerified: true,
  isAdmin: true,
  accountLevel: true,
} as const;

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

    const { password, displayName } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    // Ищем и по приведённой, и по введённой: иначе на «Vova@Mail.ru» завёлся
    // бы второй аккаунт поверх уже существующего «vova@mail.ru»
    const existing = await findUserByEmail(parsed.data.email);
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
      select: { ...PROFILE_SELECT, tokenVersion: true },
    });

    /*
     * Письмо шлём, но вход не задерживаем.
     *
     * Требовать подтверждения до первого входа — значит терять людей на
     * ровном месте: письмо задержалось, ушло в спам, человек закрыл вкладку.
     * Адрес подтверждается по ходу, а от неподтверждённых закрываются
     * отдельные вещи — приглашения на их адрес и лимиты бесплатного тарифа.
     */
    const verifyToken = await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    // Не ждём SMTP: письмо не должно держать ответ. Сбой ловит sendMail сам.
    void sendMail(request.log, verifyEmailLetter(user.email, verifyToken));

    // Поколение токена вшивается в него: хук сверит его с базой на каждом запросе
    const accessToken = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      ver: user.tokenVersion,
    });

    const { tokenVersion: _ignored, ...safeUser } = user;
    return reply.code(201).send({ user: toUserDTO(safeUser), accessToken });
  });

  // ── POST /api/auth/verify — подтвердить адрес по ссылке из письма ──
  fastify.post('/verify', async (request, reply) => {
    // Токен — 256 бит, перебором не берётся, но ограничитель убирает
    // возможность заваливать базу запросами
    rateLimit(request, 'verify', 60, 15 * 60_000);

    const token = (request.body as { token?: string })?.token ?? '';
    const claimed = await claimEmailToken(token, 'VERIFY_EMAIL');
    if (!claimed) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        message: 'Ссылка недействительна или устарела. Запросите письмо заново.',
        statusCode: 400,
      });
    }

    await prisma.user.update({
      where: { id: claimed.userId },
      data: { emailVerified: new Date() },
    });

    return reply.send({ ok: true, already: claimed.already });
  });

  // ── POST /api/auth/verify/resend — отправить письмо заново ──
  fastify.post('/verify/resend', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const me = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!me) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден', statusCode: 404 });
    }
    if (me.emailVerified) return reply.send({ ok: true, already: true });

    // По учётной записи, а не по адресу источника: иначе один человек
    // рассылает себе письма пачками, и почтовый провайдер считает нас спамом
    rateLimitAccount('verify-resend', me.id, 5, 60 * 60_000);

    const token = await issueEmailToken(me.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await sendMail(request.log, verifyEmailLetter(me.email, token));
    return reply.send({ ok: true });
  });

  // ── POST /api/auth/password/forgot — письмо со ссылкой на смену ──
  fastify.post('/password/forgot', async (request, reply) => {
    rateLimit(request, 'forgot', 60, 15 * 60_000);

    const parsed = forgotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const user = await findUserByEmail(parsed.data.email);

    /*
     * Ответ одинаковый, есть такой адрес или нет.
     *
     * Иначе форма восстановления превращается в проверялку: перебирая адреса,
     * посторонний узнаёт, кто зарегистрирован в сервисе. Для человека разницы
     * нет — он в любом случае идёт смотреть почту.
     */
    if (user) {
      // Ограничение по учётной записи здесь важнее прочего: без него чужой
      // ящик заваливают письмами «смените пароль» бесконечно
      try {
        rateLimitAccount('forgot', user.id, 3, 60 * 60_000);
        const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
        await sendMail(request.log, resetPasswordLetter(user.email, token));
      } catch {
        // Лимит исчерпан — молчим ровно так же, как при несуществующем адресе
      }
    }

    return reply.send({ ok: true });
  });

  // ── POST /api/auth/password/reset — задать новый пароль по токену ──
  fastify.post('/password/reset', async (request, reply) => {
    rateLimit(request, 'reset', 60, 15 * 60_000);

    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const claimed = await claimEmailToken(parsed.data.token, 'RESET_PASSWORD');
    if (!claimed) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        message: 'Ссылка недействительна или устарела. Запросите новую.',
        statusCode: 400,
      });
    }
    const userId = claimed.userId;

    /*
     * Вместе с паролем обесцениваем все выданные токены доступа.
     *
     * Пароль меняют обычно потому, что к учётной записи кто-то получил доступ.
     * Оставить его сессию живой значит не решить ровно ту задачу, ради которой
     * пароль и меняли.
     *
     * Заодно считаем адрес подтверждённым: человек только что доказал, что
     * читает этот ящик, — ровно то же, что доказывает письмо подтверждения.
     */
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.newPassword, 12),
        tokenVersion: { increment: 1 },
        emailVerified: new Date(),
      },
    });

    return reply.send({ ok: true });
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

    // Регистр в адресе значения не имеет: «Vova@Mail.ru» и «vova@mail.ru» —
    // один ящик. Поиск учитывает и старые записи, заведённые до нормализации
    const user = await findUserByEmail(email);
    if (!user) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверный email или пароль',
        statusCode: 401,
      });
    }

    if (!user.passwordHash) {
      return reply.code(401).send({
        error: 'SOCIAL_ONLY',
        message: 'Этот аккаунт входит через соцсеть. Нажмите кнопку Яндекс, Google или Telegram на странице входа.',
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

    /*
     * Заблокированному токен не выдаём вовсе.
     *
     * Проверка стоит ПОСЛЕ пароля намеренно: иначе по разнице ответов любой
     * желающий перебирал бы адреса и узнавал, кто у нас заблокирован, не зная
     * ни одного пароля.
     */
    if (user.bannedAt) {
      return reply.code(403).send({
        error: 'ACCOUNT_BANNED',
        message: user.banReason
          ? `Учётная запись заблокирована. Причина: ${user.banReason}`
          : 'Учётная запись заблокирована',
        statusCode: 403,
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
        emailVerified: user.emailVerified,
        isAdmin: user.isAdmin,
        accountLevel: user.accountLevel,
      }),
      accessToken,
    });
  });

  // ── GET /api/auth/me ──────────────────────
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: PROFILE_SELECT,
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
      select: PROFILE_SELECT,
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

    if (!user.passwordHash) {
      return reply.code(400).send({
        error: 'SOCIAL_ONLY',
        message: 'У этого аккаунта нет пароля — входите через ту соцсеть, которой регистрировались.',
        statusCode: 400,
      });
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
    /*
     * Свой предел, уже общего. Аватар читается в память целиком и оттуда
     * отдаётся в sharp: с общим пределом в триста мегабайт любой участник
     * занимал бы столько же оперативной памяти одним запросом, а несколькими
     * подряд ронял бы бэкенд. Картинке 256×256 восьми мегабайт хватает с
     * запасом на любой снимок с телефона.
     */
    const data = await request.file({ limits: { fileSize: IMAGE_LIMIT } });
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
      select: PROFILE_SELECT,
    });

    return reply.send(toUserDTO(user));
  });
}
