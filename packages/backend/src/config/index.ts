import * as dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isDev = nodeEnv === 'development';
/**
 * Строгие правила включает именно `production`, а не «всё, что не разработка».
 * Тесты идут под `NODE_ENV=test` — приравняв их к продакшну, я разом уронил
 * загрузку всего набора: конфиг требовал секретов, которых в тестах нет.
 */
const isProd = nodeEnv === 'production';

/**
 * Обязательная переменная окружения.
 *
 * Запасное значение действует где угодно, но НЕ в продакшне. Раньше оно
 * подставлялось везде, и функция с именем `required` тихо разрешала запуск
 * продакшна с секретом подписи токенов, лежащим в репозитории: с ним
 * подделывается токен любого пользователя.
 *
 * Пустая строка считается отсутствием значения намеренно. `docker compose`
 * подставляет пустую строку вместо незаданной переменной, а `??` пустую строку
 * пропускает как настоящее значение — так продакшн мог подписывать токены
 * пустым ключом.
 */
function required(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val) return val;

  if (!isProd && fallback !== undefined) return fallback;

  throw new Error(
    `Не задана переменная окружения ${key}. ` +
      'В продакшне запасных значений нет: тайно работать с известным ключом опаснее, чем не запуститься.',
  );
}

/** Ключ короче 32 символов перебирается — предупредить лучше сразу */
function requireStrongSecret(key: string, fallback: string): string {
  const val = required(key, fallback);
  if (isProd && val.length < 32) {
    throw new Error(`${key} короче 32 символов — такой ключ подбирается перебором`);
  }
  return val;
}

export const config = {
  analytics: {
    /**
     * Кому доступна сводка воронки. Отдельной роли админа в системе нет,
     * поэтому список задаётся переменной окружения ANALYTICS_ADMIN_EMAILS
     * (через запятую). Пусто — сводку не видит никто.
     */
    adminEmails: (process.env.ANALYTICS_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },

  port: parseInt(process.env.PORT ?? '4000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv,
  isDev,

  database: {
    url: required('DATABASE_URL', 'postgresql://vovplan:vovplan@localhost:5432/vovplan?schema=public'),
  },

  jwt: {
    secret: requireStrongSecret('JWT_SECRET', 'dev-secret-change-in-production-please-use-32+chars'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  /*
   * Настроек S3 здесь больше нет.
   *
   * Ими никто не пользовался: файлы лежат на диске в uploads/ и раздаются
   * подписанными ссылками. Зато в конфиге стояли рабочие ключ и пароль по
   * умолчанию — мёртвая настройка, которая выглядит как живой секрет. При
   * переезде в объектное хранилище вернуть её недолго, и уже без значений
   * по умолчанию, как сделано с JWT_SECRET.
   */

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  },

  /**
   * Адрес, по которому сервис виден снаружи. Из него собираются ссылки в
   * письмах: подставлять туда адрес бэкенда нельзя, человек должен попасть
   * на страницу, а не на голый ответ API.
   */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),

  /**
   * Почта первого хозяина на пустой базе. Не попадает ни во фронт, ни в
   * ответы API: читается только при старте, и только если администраторов
   * ещё нет. Пусто — ничего не происходит, тогда права выдаёт скрипт.
   */
  bootstrapAdminEmail: (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase(),

  /**
   * Почта. Через SMTP, а не через API конкретного сервиса: SMTP есть у всех,
   * и смена провайдера — это правка переменных, а не кода.
   * Без host письма не отправляются, а печатаются в лог.
   */
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'VOVPLAN <noreply@vovplan.com>',
  },
} as const;

export type Config = typeof config;
