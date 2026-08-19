import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка данных виджета Telegram Login.
 *
 * Telegram считает подпись так: секрет — SHA-256 от токена бота, строка —
 * поля кроме hash, отсортированные как `key=value` через перевод строки.
 * Без сравнения с постоянным временем подпись можно было бы подбирать
 * по времени ответа — здесь оно ни к чему, но HMAC так сравнивают всегда.
 */

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
): boolean {
  if (!botToken || !payload.hash) return false;

  const ageMs = Date.now() - payload.auth_date * 1000;
  // Сутки: виджет могли открыть и не нажать сразу
  if (!Number.isFinite(payload.auth_date) || ageMs > 24 * 60 * 60 * 1000 || ageMs < -60_000) {
    return false;
  }

  const dataCheck = Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(payload.hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function telegramDisplayName(payload: TelegramAuthPayload): string {
  const parts = [payload.first_name, payload.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (payload.username) return payload.username;
  return 'Пользователь';
}
