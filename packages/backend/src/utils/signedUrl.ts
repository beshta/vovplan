import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Подписанные ссылки на загруженные файлы.
 *
 * Файлы из `/uploads/` раздавались всем подряд: модели, текстуры рельефа и
 * аватары любого проекта скачивал кто угодно, зная ссылку, — а ссылки утекают
 * через публичные share-ссылки навсегда.
 *
 * Закрыть их обычной проверкой токена нельзя: браузер не прикладывает заголовок
 * `Authorization`, когда грузит картинку в `<img>` или модель загрузчиком
 * three.js. Поэтому право доступа кладётся в саму ссылку — подписью, которую
 * подделать нельзя, и со сроком годности.
 */

/**
 * Ключ подписи выводится из секрета токенов, а не заводится отдельной
 * переменной: одной обязательной настройкой в продакшне меньше, и она уже
 * проверяется на длину при старте. Отдельная приписка `|uploads` разводит
 * назначения — подписью ссылки нельзя подписать токен и наоборот.
 */
const KEY = createHash('sha256').update(`${config.jwt.secret}|uploads`).digest();

/** Сколько ссылка живёт. Хватает на долгий сеанс, но не навсегда. */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Шаг округления срока — час.
 *
 * Без него у каждой выдачи был бы свой `exp`, то есть свой адрес, и кэш
 * браузера с сервис-воркером промахивались бы каждый раз: модели на десятки
 * мегабайт качались бы заново при каждом открытии сцены. С округлением адрес
 * не меняется в течение часа и кэшируется как обычно.
 */
const BUCKET_MS = 60 * 60 * 1000;

function sign(path: string, exp: number): string {
  return createHmac('sha256', KEY).update(`${path}\n${exp}`).digest('base64url');
}

/**
 * Добавляет подпись к пути вида `/uploads/...`.
 *
 * Пути не из `/uploads/` возвращаются как есть: подписывать чужие адреса
 * незачем, а молча портить их — тем более.
 */
export function signUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/uploads/')) return url;

  const exp = Math.ceil((Date.now() + TTL_MS) / BUCKET_MS) * BUCKET_MS;
  return `${url}?exp=${exp}&sig=${sign(url, exp)}`;
}

/** Проверяет подпись пути. `path` — без строки запроса. */
export function verifyUploadSignature(path: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;

  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;

  const expected = Buffer.from(sign(path, expNum));
  const given = Buffer.from(sig);
  // Разная длина ломает timingSafeEqual, а не просто даёт false
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Проходит по метаданным рельефа и подписывает все ссылки внутри.
 *
 * Метаданные — свободный JSON, и адреса лежат в нём вперемешку с числами и
 * многоугольниками. Перебираем значения, а не перечисляем поля поимённо:
 * список полей уже дважды дополнялся (спутник, здания, природа), и забыть
 * очередное — значит тихо оставить дыру.
 */
export function signTerrainMeta(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object') return meta;

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return signUploadUrl(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };

  return walk(meta);
}
