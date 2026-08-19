import type { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../../db/prisma.js';
import { HttpError } from '../../utils/errors.js';
import { verifyAdminToken, isFresh } from '../../utils/adminToken.js';

/**
 * Охрана админки.
 *
 * Проверка живёт в хуке на префиксе, а не в каждом обработчике. Забыть
 * `preHandler` в одном маршруте из двадцати — вопрос времени, и цена такой
 * забывчивости здесь не «показали лишнее», а чужие проекты в чужих руках.
 * Хук же действует на всё, что зарегистрировано в этой области видимости,
 * включая маршруты, которых ещё нет.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Пропуск в админку: проверен хуком, иначе до обработчика не дойти */
    adminPass?: { userId: string; issuedAt: number };
  }
}

const ADMIN_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  isAdmin: true,
  tokenVersion: true,
  totpSecret: true,
  totpEnabled: true,
} as const;

export type AdminAccount = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  tokenVersion: number;
  totpSecret: string | null;
  totpEnabled: Date | null;
};

/**
 * Загружает учётку и убеждается, что она хозяйская.
 *
 * Не-администратору отвечаем 404, а не 403. «Недостаточно прав» — это
 * подтверждение, что админка по этому адресу есть; чем меньше людей знает,
 * куда стучаться, тем меньше желающих. Для самого хозяина разницы нет: он
 * администратор, и 404 не увидит.
 */
export async function loadAdmin(request: FastifyRequest): Promise<AdminAccount> {
  const me = await prisma.user.findUnique({
    where: { id: request.user.userId },
    select: ADMIN_FIELDS,
  });

  if (!me || !me.isAdmin) {
    throw new HttpError(404, 'NOT_FOUND', 'Не найдено');
  }

  return me;
}

/**
 * Второй хук после `authenticate`: пускает дальше только с действующим
 * пропуском.
 *
 * Обычного токена мало намеренно. Он живёт неделю и лежит в браузере —
 * если бы его хватало, вход в админку сводился бы к краже одной строки из
 * localStorage, и второй фактор был бы украшением.
 */
export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const me = await loadAdmin(request);

  const pass = verifyAdminToken(request.headers['x-admin-token'] as string | undefined);

  // Чужой пропуск не годится, даже если он настоящий: подпись подтверждает
  // происхождение, но не то, что он выдан этому человеку
  if (!pass || pass.userId !== me.id) {
    return reply.code(401).send({
      error: 'ADMIN_SESSION_REQUIRED',
      message: 'Требуется вход в админку',
      statusCode: 401,
    });
  }

  // Смена пароля и отзыв сессий гасят и пропуск: иначе «выйти отовсюду»
  // выгоняло бы отовсюду, кроме самого чувствительного места
  if (pass.tokenVersion !== me.tokenVersion) {
    return reply.code(401).send({
      error: 'ADMIN_SESSION_REQUIRED',
      message: 'Требуется вход в админку',
      statusCode: 401,
    });
  }

  request.adminPass = { userId: pass.userId, issuedAt: pass.issuedAt };
}

/**
 * Для действий, которые нельзя отменить: блокировка и выдача прав.
 *
 * Полчаса жизни пропуска — это полчаса, в течение которых оставленная
 * открытой вкладка блокирует кого угодно. Свежесть требует, чтобы код
 * набрали только что, и превращает «дотянулся до чужого ноутбука» в
 * «нужен ещё и телефон».
 */
export function requireFresh(request: FastifyRequest): void {
  const pass = request.adminPass;
  if (!pass || !isFresh(pass)) {
    throw new HttpError(
      403,
      'STEP_UP_REQUIRED',
      'Подтвердите действие кодом из приложения',
    );
  }
}
