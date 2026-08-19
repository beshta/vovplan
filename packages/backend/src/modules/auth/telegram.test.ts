import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramDisplayName, verifyTelegramAuth } from './telegram.js';

/**
 * Подпись виджета Telegram Login. Алгоритм из документации Telegram:
 * секрет — SHA-256(bot_token), строка — поля кроме hash, сортировка
 * `key=value` через перевод строки, HMAC-SHA256 в hex.
 *
 * Считаем подпись здесь отдельно от проверяемого кода: иначе тест говорил бы
 * только «совпало с собственной реализацией».
 */
function telegramHash(
  fields: Record<string, string | number>,
  botToken: string,
): string {
  const dataCheck = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheck).digest('hex');
}

const BOT = '123456:ABC-DEF';
const NOW = new Date('2024-06-01T12:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyTelegramAuth', () => {
  it('принимает верную подпись', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fields = {
      id: 42,
      first_name: 'Ivan',
      username: 'ivan',
      auth_date: Math.floor(NOW.getTime() / 1000),
    };
    expect(
      verifyTelegramAuth({ ...fields, hash: telegramHash(fields, BOT) }, BOT),
    ).toBe(true);
  });

  it('отклоняет подпись с чужим токеном', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fields = { id: 42, auth_date: Math.floor(NOW.getTime() / 1000) };
    expect(
      verifyTelegramAuth({ ...fields, hash: telegramHash(fields, BOT) }, 'other:token'),
    ).toBe(false);
  });

  it('отклоняет подпись, если поле подменили', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fields = { id: 42, auth_date: Math.floor(NOW.getTime() / 1000) };
    const hash = telegramHash(fields, BOT);
    expect(verifyTelegramAuth({ id: 99, auth_date: fields.auth_date, hash }, BOT)).toBe(false);
  });

  it('отклоняет данные старше суток', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fields = {
      id: 42,
      auth_date: Math.floor(NOW.getTime() / 1000) - 25 * 60 * 60,
    };
    expect(
      verifyTelegramAuth({ ...fields, hash: telegramHash(fields, BOT) }, BOT),
    ).toBe(false);
  });

  it('отклоняет пустой токен и пустой hash', () => {
    expect(
      verifyTelegramAuth({ id: 1, auth_date: 1, hash: 'ab' }, ''),
    ).toBe(false);
    expect(
      verifyTelegramAuth({ id: 1, auth_date: 1, hash: '' }, BOT),
    ).toBe(false);
  });
});

describe('telegramDisplayName', () => {
  it('собирает имя из first/last, иначе username', () => {
    expect(telegramDisplayName({ id: 1, auth_date: 1, hash: 'x', first_name: 'A', last_name: 'B' })).toBe('A B');
    expect(telegramDisplayName({ id: 1, auth_date: 1, hash: 'x', username: 'nick' })).toBe('nick');
    expect(telegramDisplayName({ id: 1, auth_date: 1, hash: 'x' })).toBe('Пользователь');
  });
});
