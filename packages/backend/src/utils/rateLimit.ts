import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

/**
 * Ограничитель частоты запросов для чувствительных эндпоинтов (вход,
 * регистрация, смена пароля). Без него пароль можно подбирать бесконечно.
 *
 * Счётчики в памяти процесса: приложение разворачивается одним контейнером,
 * поэтому этого достаточно. При масштабировании на несколько экземпляров
 * счётчики надо будет вынести в общее хранилище (Redis) — иначе лимит
 * поделится на число реплик.
 */

interface Bucket {
  count: number;
  /** Момент, когда окно закончится (мс) */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Раз в 10 минут выкидываем истёкшие окна, чтобы карта не росла бесконечно */
const CLEANUP_INTERVAL = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/** Общая механика: увеличить счётчик по ключу, бросить 429 при переполнении */
function hit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  cleanup(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count++;
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw new HttpError(
      429,
      'TOO_MANY_REQUESTS',
      `Слишком много попыток. Попробуйте через ${retryAfter} с.`,
    );
  }
}

/**
 * Счётчик по адресу источника.
 *
 * Работает как защита от простого потока запросов, но НЕ как защита от
 * подбора пароля: за обратным прокси все запросы приходят с одного адреса,
 * и лимит становится общим на всех сразу. Поэтому пороги здесь щедрые —
 * жёсткий счёт ведётся по учётной записи (`rateLimitAccount`), а к
 * заголовкам прокси доверия пока нет.
 *
 * @param scope    имя эндпоинта — у каждого свой счётчик
 * @param limit    сколько запросов разрешено в окне
 * @param windowMs длина окна, мс
 */
export function rateLimit(
  request: FastifyRequest,
  scope: string,
  limit: number,
  windowMs: number,
): void {
  hit(`${scope}:ip:${request.ip}`, limit, windowMs);
}

/**
 * Счётчик по учётной записи — то, что реально мешает подбирать пароль.
 *
 * Не зависит ни от прокси, ни от того, с какого адреса идут попытки: злоумышленник
 * с тысячей адресов упирается в тот же предел. Ключ приводится к нижнему регистру
 * и очищается от пробелов, иначе счётчик обходится сменой регистра в почте.
 */
export function rateLimitAccount(
  scope: string,
  account: string,
  limit: number,
  windowMs: number,
): void {
  hit(`${scope}:acct:${account.trim().toLowerCase()}`, limit, windowMs);
}

/** Сбросить счётчик по адресу — вызывается после успешного входа */
export function rateLimitReset(request: FastifyRequest, scope: string): void {
  buckets.delete(`${scope}:ip:${request.ip}`);
}

/** Сбросить счётчик учётной записи — успешный вход снимает подозрения */
export function rateLimitAccountReset(scope: string, account: string): void {
  buckets.delete(`${scope}:acct:${account.trim().toLowerCase()}`);
}

/** Только для тестов: очистить все счётчики между кейсами */
export function rateLimitClearAll(): void {
  buckets.clear();
}
