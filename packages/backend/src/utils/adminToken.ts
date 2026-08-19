import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Пропуск в админку — отдельный токен, а не признак внутри обычного.
 *
 * Обычный токен живёт неделю и лежит в localStorage браузера: любая
 * межсайтовая дыра выносит его целиком. Если бы права хозяина сервиса ехали в
 * нём же, украденный токен означал бы чужие проекты в чужих руках. Поэтому
 * доступ к `/api/admin` даёт только этот пропуск: он выдаётся в обмен на код
 * из приложения-аутентификатора и живёт полчаса.
 */

/**
 * Ключ подписи выводится из секрета токенов с собственной припиской — как у
 * подписанных ссылок в `signedUrl.ts`.
 *
 * Разные ключи здесь не про аккуратность, а про физическую невозможность
 * подмены. Будь ключ общим, пропуск в админку прошёл бы проверку обычного
 * токена везде, где она есть: в `authenticate` и в рукопожатии сокета —
 * там читают `userId` и поколение, а до незнакомых полей никому нет дела.
 * С разными ключами такой токен просто не проверится, и забыть об этом
 * в новом месте нельзя.
 */
const KEY = createHash('sha256').update(`${config.jwt.secret}|admin`).digest();

/**
 * Сколько живёт пропуск. Полчаса — компромисс: набирать код на каждое
 * движение невыносимо, а забытая открытой вкладка не должна оставаться
 * ключом от сервиса до конца дня.
 */
export const ADMIN_TTL_MS = 30 * 60 * 1000;

/**
 * Порог свежести для разрушительных действий.
 *
 * Блокировка и выдача прав требуют, чтобы код вводили только что, — иначе
 * захваченная вкладка позволяет их полчаса. Отдельного «подтвердите ещё раз»
 * с кодом в теле запроса нет намеренно: одна механика вместо двух, и сразу
 * после ввода кода работать можно, не набирая его второй раз.
 */
export const ADMIN_FRESH_MS = 5 * 60 * 1000;

export interface AdminTokenPayload {
  /** Кому выдан */
  userId: string;
  /** Поколение токенов пользователя на момент выдачи */
  tokenVersion: number;
  /** Когда выдан, мс */
  issuedAt: number;
}

function sign(body: string): string {
  return createHmac('sha256', KEY).update(body).digest('base64url');
}

/** Пропуск: тело в base64url и подпись через точку */
export function issueAdminToken(userId: string, tokenVersion: number): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, v: tokenVersion, t: Date.now() }),
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Проверяет подпись и срок. Возвращает содержимое или null — разбираться,
 * что именно не так с чужим токеном, вызывающему незачем.
 */
export function verifyAdminToken(token: string | undefined): AdminTokenPayload | null {
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(token.slice(dot + 1));
  // Разная длина ломает timingSafeEqual, а не просто даёт false
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  let parsed: { u?: unknown; v?: unknown; t?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }

  const { u, v, t } = parsed;
  if (typeof u !== 'string' || typeof v !== 'number' || typeof t !== 'number') return null;
  if (Date.now() - t > ADMIN_TTL_MS) return null;

  return { userId: u, tokenVersion: v, issuedAt: t };
}

/** Свежий ли пропуск — для действий, которые нельзя отменить */
export const isFresh = (pass: { issuedAt: number }): boolean =>
  Date.now() - pass.issuedAt <= ADMIN_FRESH_MS;
