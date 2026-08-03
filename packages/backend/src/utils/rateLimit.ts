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

/**
 * Проверяет и увеличивает счётчик. Бросает 429, если лимит исчерпан.
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
  const now = Date.now();
  cleanup(now);

  const key = `${scope}:${request.ip}`;
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

/** Сбросить счётчик — вызывается после успешного входа */
export function rateLimitReset(request: FastifyRequest, scope: string): void {
  buckets.delete(`${scope}:${request.ip}`);
}

/** Только для тестов: очистить все счётчики между кейсами */
export function rateLimitClearAll(): void {
  buckets.clear();
}
