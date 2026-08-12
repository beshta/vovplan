import { createHash, randomBytes } from 'node:crypto';
import type { EmailTokenPurpose } from '@prisma/client';
import prisma from '../db/prisma.js';

/**
 * Одноразовые токены из писем: подтверждение адреса и смена пароля.
 *
 * В базе лежит SHA-256 от токена, а не сам токен. Хеширование здесь без соли и
 * без bcrypt намеренно: токен — 256 случайных бит, перебирать его нечем, и
 * медленная функция только зря нагружала бы проверку. Смысл хеша в другом:
 * у того, кто прочитает базу, не должно оказаться в руках готовой ссылки для
 * смены чужого пароля.
 */

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Сутки на подтверждение адреса: письмо могут открыть и на следующий день */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** Час на смену пароля: окно должно быть узким, это ключ от учётной записи */
export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Выпускает токен и возвращает его открытую часть — её и кладём в письмо.
 *
 * Прежние невыполненные токены того же назначения гасятся: если человек
 * запросил письмо заново, старая ссылка работать не должна. Иначе каждое
 * повторное письмо добавляло бы ещё один действующий ключ, и через три
 * запроса их было бы три.
 */
export async function issueEmailToken(
  userId: string,
  purpose: EmailTokenPurpose,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await prisma.emailToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.emailToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return token;
}

/**
 * Проверяет токен и сразу помечает использованным. Возвращает id владельца
 * или null, если токен не подходит.
 *
 * Пометка ставится условным обновлением, как и при приёме приглашения: между
 * «прочитал и увидел, что не использован» и «записал, что использован»
 * успевает вклиниться второй такой же запрос, и по одной ссылке сработали бы
 * оба. Условие проверяет сама база.
 */
export async function claimEmailToken(
  token: string,
  purpose: EmailTokenPurpose,
): Promise<string | null> {
  if (!token) return null;

  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record) return null;
  if (record.purpose !== purpose) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;

  const claimed = await prisma.emailToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return record.userId;
}
