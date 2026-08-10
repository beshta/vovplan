import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Секрет подписи токенов — единственное, что отделяет чужой аккаунт от
 * подделанного токена. Раньше при отсутствии переменной подставлялось значение
 * из открытого репозитория, и продакшн мог годами работать с ключом, который
 * знает каждый, кто открыл исходники. Ни одна проверка бы этого не заметила.
 *
 * Поэтому здесь проверяется не «конфиг читается», а «в продакшне без ключа
 * приложение отказывается стартовать».
 */

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

/** Свежий импорт конфига с заданным окружением */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...saved, ...env };
  return import('./config/index.js');
}

describe('обязательные переменные окружения', () => {
  it('в продакшне без JWT_SECRET приложение не стартует', async () => {
    await expect(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        JWT_SECRET: undefined,
      }),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('пустая строка считается отсутствием значения', async () => {
    // Именно это подставляет docker compose вместо незаданной переменной
    await expect(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        JWT_SECRET: '',
      }),
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('короткий ключ в продакшне отвергается', async () => {
    await expect(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        JWT_SECRET: 'слишком-короткий',
      }),
    ).rejects.toThrow(/32/);
  });

  it('в продакшне без DATABASE_URL приложение не стартует', async () => {
    await expect(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        JWT_SECRET: 'x'.repeat(40),
      }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it('нормальный продакшн-набор читается', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_SECRET: 'x'.repeat(40),
    });
    expect(config.jwt.secret).toHaveLength(40);
    expect(config.isDev).toBe(false);
  });

  it('в разработке запасные значения работают — иначе не поднять локально', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: undefined,
      JWT_SECRET: undefined,
    });
    expect(config.jwt.secret).toBeTruthy();
    expect(config.isDev).toBe(true);
  });

  // Строгость включает именно production. Тесты идут под NODE_ENV=test, и
  // приравнять их к продакшну — значит уронить загрузку всего набора
  it('под NODE_ENV=test запасные значения тоже работают', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: undefined,
      JWT_SECRET: undefined,
    });
    expect(config.jwt.secret).toBeTruthy();
  });
});
