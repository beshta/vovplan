import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

/**
 * Второй фактор через приложение-аутентификатор (Яндекс.Ключ, Google
 * Authenticator, 1Password и любое другое).
 *
 * Коды по тридцать секунд, ничего никуда не отправляется — ни почтового
 * провайдера, ни оплаты СМС. Для одного аккаунта хозяина это единственный
 * разумный вариант.
 */

const ISSUER = 'VOVPLAN';

/** Шаг кода, секунды. Тридцать — то, что ожидают все приложения */
const PERIOD = 30;

/**
 * Допуск по времени: ±1 шаг.
 *
 * Часы на телефоне и на сервере расходятся, и без допуска человек с
 * отставанием в двадцать секунд не войдёт никогда. Больше одного шага брать
 * нельзя: каждый шаг допуска расширяет окно, в котором подсмотренный код
 * ещё годится.
 */
const WINDOW = 1;

function totpFor(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

/** Новый секрет в base32 — его человек переносит в приложение */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/**
 * Ссылка otpauth:// для QR-кода.
 *
 * В ней и название сервиса, и адрес почты: в приложении у человека десятки
 * кодов, и «VOVPLAN (info@…)» отличается от безымянной строки.
 */
export function totpUri(secret: string, email: string): string {
  return totpFor(secret, email).toString();
}

/**
 * Проверяет код. Возвращает номер шага времени, на котором он сошёлся, или
 * null. Номер нужен вызывающему, чтобы не принять тот же код второй раз.
 */
export function verifyTotp(secret: string, token: string): number | null {
  const clean = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;

  const delta = totpFor(secret, 'x').validate({ token: clean, window: WINDOW });
  if (delta === null) return null;

  // Абсолютный номер шага: текущий плюс смещение, на котором код совпал
  return Math.floor(Date.now() / 1000 / PERIOD) + delta;
}

// ── Резервные коды ───────────────────────────────────────────────────────────

/** Сколько выдаём за раз */
const BACKUP_COUNT = 10;

/**
 * Коды вида « a3f9-2b71 ». Не слова и не цифры подряд: их переписывают
 * руками с экрана на бумагу, и дефис посередине заметно снижает шанс
 * ошибиться.
 */
export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_COUNT }, () => {
    const raw = randomBytes(4).toString('hex'); // 8 знаков, 32 бита
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

/**
 * Хеш резервного кода.
 *
 * SHA-256 без соли — сознательно, как и у токенов из писем: код это 32
 * случайных бита, перебирать его по хешу нечем, а медленная функция только
 * нагружала бы проверку. Смысл хеширования в том, чтобы у прочитавшего базу
 * не оказалось в руках готового ключа.
 */
export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(normalizeBackupCode(code)).digest('hex');

/** Приводим к единому виду: регистр и дефисы человек воспроизводит как придётся */
export const normalizeBackupCode = (code: string): string =>
  code.toLowerCase().replace(/[^a-f0-9]/g, '');

/** Сравнение хешей за постоянное время — привычка, которая ничего не стоит */
export function backupCodeMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
