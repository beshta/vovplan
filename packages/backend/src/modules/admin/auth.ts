import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import prisma from '../../db/prisma.js';
import { HttpError } from '../../utils/errors.js';
import { rateLimitAccount, rateLimitAccountReset } from '../../utils/rateLimit.js';
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
} from '../../utils/totp.js';
import { issueAdminToken, ADMIN_TTL_MS } from '../../utils/adminToken.js';
import { logAdminAction, labelOf } from '../../utils/adminAudit.js';
import { loadAdmin } from './guard.js';

/**
 * Вход в админку: подключение второго фактора и обмен кода на пропуск.
 *
 * Эти маршруты живут ОТДЕЛЬНО от остальной админки и не закрыты пропуском —
 * иначе получить пропуск было бы нечем. Охрана здесь другая: обычный токен
 * плюс признак хозяина в базе.
 */

const codeSchema = z.object({
  code: z.string().min(6).max(32),
});

/**
 * Последний принятый шаг времени у каждого хозяина.
 *
 * Без этого подсмотренный код годится все тридцать секунд своей жизни плюс
 * допуск. В памяти процесса, а не в базе: контейнер один, а лишняя колонка
 * означала бы правку обеих схем Prisma ради значения, которое живёт
 * полторы минуты. Перезапуск обнуляет — худшее, что это даёт, окно в
 * полторы минуты сразу после рестарта.
 */
const lastStep = new Map<string, number>();

/**
 * Шаг принимается, только если он больше прошлого.
 *
 * Не «не равен», а именно больше. Допуск в один шаг делает годными сразу три
 * кода — предыдущий, текущий и следующий; при сравнении на равенство код
 * прошлой минуты остался бы рабочим после кода нынешней. Часы идут вперёд, и
 * проверка идёт вперёд вместе с ними.
 */
function claimStep(userId: string, step: number): boolean {
  const seen = lastStep.get(userId);
  if (seen !== undefined && step <= seen) return false;
  lastStep.set(userId, step);
  return true;
}

/**
 * Резервный код: списывается условным обновлением, а не «нашёл — пометил».
 *
 * Между чтением и записью успевает пройти второй запрос, и один код сработал
 * бы дважды — та же ошибка, что уже ловили на одноразовых приглашениях.
 */
async function claimBackupCode(userId: string, code: string): Promise<boolean> {
  const hash = hashBackupCode(code);
  const { count } = await prisma.totpBackupCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

export default async function adminAuthRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  // ── GET /api/admin/auth/status — что показывать: настройку или поле кода ──
  fastify.get('/status', async (request, reply) => {
    const me = await loadAdmin(request);
    return reply.send({
      totpEnabled: me.totpEnabled !== null,
      /** Секрет выдан, но первым кодом не подтверждён — настройку надо доделать */
      totpPending: me.totpSecret !== null && me.totpEnabled === null,
    });
  });

  // ── POST /api/admin/auth/totp/setup — выдать секрет и QR ──
  fastify.post('/totp/setup', async (request, reply) => {
    const me = await loadAdmin(request);

    /*
     * Переподключать работающий фактор через этот маршрут нельзя: иначе
     * захваченная сессия просто перевыпустила бы секрет на свой телефон и
     * обошла защиту целиком. Снять фактор можно только резервным кодом.
     */
    if (me.totpEnabled) {
      throw new HttpError(409, 'CONFLICT', 'Второй фактор уже подключён');
    }

    /*
     * Секрет выдаётся заново при каждом заходе. Прежний неподтверждённый
     * ничего не стоит — он никогда не работал, — а перенести в приложение
     * могли и наполовину.
     */
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: me.id }, data: { totpSecret: secret } });

    const uri = totpUri(secret, me.email);
    return reply.send({
      secret,
      uri,
      /** Картинка сразу с сервера: набирать двадцать знаков руками незачем */
      qr: await QRCode.toDataURL(uri),
    });
  });

  // ── POST /api/admin/auth/totp/enable — подтвердить первым кодом ──
  fastify.post('/totp/enable', async (request, reply) => {
    const me = await loadAdmin(request);

    if (me.totpEnabled) {
      throw new HttpError(409, 'CONFLICT', 'Второй фактор уже подключён');
    }
    if (!me.totpSecret) {
      throw new HttpError(400, 'BAD_REQUEST', 'Сначала получите секрет');
    }

    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Введите код из приложения');
    }

    rateLimitAccount('admin-totp', me.id, 10, 15 * 60_000);

    const step = verifyTotp(me.totpSecret, parsed.data.code);
    if (step === null) {
      throw new HttpError(400, 'INVALID_CODE', 'Код не подошёл');
    }
    claimStep(me.id, step);

    /*
     * Резервные коды показываются один раз — здесь. В базе только хеши,
     * восстановить их потом неоткуда, и это правильно: список, который
     * можно посмотреть повторно, ничем не лучше пароля на стикере.
     */
    const codes = generateBackupCodes();

    await prisma.$transaction([
      prisma.totpBackupCode.deleteMany({ where: { userId: me.id } }),
      prisma.totpBackupCode.createMany({
        data: codes.map((code) => ({ userId: me.id, codeHash: hashBackupCode(code) })),
      }),
      prisma.user.update({ where: { id: me.id }, data: { totpEnabled: new Date() } }),
    ]);

    await logAdminAction({
      actorId: me.id,
      action: 'admin.totp-enable',
      targetUserId: me.id,
      targetLabel: labelOf(me),
      ip: request.ip,
    });

    return reply.send({ backupCodes: codes });
  });

  // ── POST /api/admin/auth/session — код в обмен на пропуск ──
  fastify.post('/session', async (request, reply) => {
    const me = await loadAdmin(request);

    if (!me.totpEnabled || !me.totpSecret) {
      throw new HttpError(403, 'TOTP_REQUIRED', 'Сначала подключите второй фактор');
    }

    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Введите код');
    }

    /*
     * Порог жёстче обычного входа (там восемь): у кода из приложения всего
     * миллион значений, и при десятке попыток в минуту он подбирается за
     * выходные. Счёт по учётной записи, а не по адресу, — за прокси адрес
     * у всех один.
     */
    rateLimitAccount('admin-2fa', me.id, 5, 15 * 60_000);

    const code = parsed.data.code;
    const step = verifyTotp(me.totpSecret, code);

    let ok = false;
    if (step !== null) {
      // Тот же код второй раз не принимаем: подсмотренный за плечом живёт
      // до полутора минут, и этого хватает, чтобы им воспользоваться
      ok = claimStep(me.id, step);
    } else {
      ok = await claimBackupCode(me.id, code);
    }

    if (!ok) {
      throw new HttpError(400, 'INVALID_CODE', 'Код не подошёл');
    }

    rateLimitAccountReset('admin-2fa', me.id);

    return reply.send({
      adminToken: issueAdminToken(me.id, me.tokenVersion),
      expiresIn: ADMIN_TTL_MS,
    });
  });
}
