import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import { issueEmailToken, VERIFY_TTL_MS, RESET_TTL_MS } from './utils/emailToken.js';
import prisma from './db/prisma.js';

/**
 * Подтверждение адреса и восстановление пароля.
 *
 * Токен из письма в тестах выпускается той же функцией, что и при рассылке:
 * открывать его наружу ради тестируемости нельзя, а в базе лежит только хеш.
 *
 * Проверяется не «письмо ушло», а свойства, на которых держится безопасность:
 * одноразовость, срок, обесценивание прежних токенов и то, что смена пароля
 * выбрасывает чужие сессии.
 */

const marker = `mailtest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';
const NEW_PASSWORD = 'vitest-fixture-pw-2';

let app: FastifyInstance;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(who: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Test ${who}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { user: { id: string; emailVerified: string | null }; accessToken: string };
}

beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { contains: marker } },
    select: { id: true },
  });
  for (const { id } of users) {
    await prisma.emailToken.deleteMany({ where: { userId: id } });
  }
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('подтверждение адреса почты', () => {
  it('регистрация заводит неподтверждённого и выпускает токен', async () => {
    const { user } = await register('verify-a');
    expect(user.emailVerified).toBeNull();

    const tokens = await prisma.emailToken.count({
      where: { userId: user.id, purpose: 'VERIFY_EMAIL', usedAt: null },
    });
    expect(tokens).toBe(1);
  });

  it('переход по ссылке подтверждает адрес, повторный тоже успех', async () => {
    const { user } = await register('verify-b');
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);

    const first = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(first.statusCode).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } });
    expect(after?.emailVerified).not.toBeNull();

    // Повтор — не ошибка: сканер почты часто открывает ссылку раньше человека
    const second = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(second.statusCode).toBe(200);
    expect(second.json().already).toBe(true);
  });

  it('токен подтверждения без дефиса — иначе почта рвёт ссылку пополам', async () => {
    const { user } = await register('verify-hex');
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('истёкший токен не подтверждает', async () => {
    const { user } = await register('verify-c');
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', -1000);
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(res.statusCode).toBe(400);
  });

  it('новое письмо гасит предыдущую ссылку', async () => {
    const { user } = await register('verify-d');
    const old = await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);

    // Иначе каждое повторное письмо добавляло бы ещё один действующий ключ
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: old } });
    expect(res.statusCode).toBe(400);
  });

  it('токен подтверждения не годится для смены пароля', async () => {
    const { user } = await register('verify-e');
    const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('восстановление пароля', () => {
  it('ответ одинаковый для существующего и несуществующего адреса', async () => {
    await register('forgot-a');

    const real = await app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      payload: { email: emailOf('forgot-a') },
    });
    const fake = await app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      // Адрес корректного вида, но такого пользователя нет: именно эту пару
      // «есть / нет» ответ и не должен различать
      payload: { email: `no-such-user.${marker}@test.vovplan.io` },
    });

    // Иначе форма восстановления превращается в проверялку «кто здесь есть»
    expect(real.statusCode).toBe(200);
    expect(fake.statusCode).toBe(200);
    expect(real.json()).toEqual(fake.json());
  });

  it('для существующего адреса выпускается токен смены', async () => {
    const { user } = await register('forgot-b');
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      payload: { email: emailOf('forgot-b') },
    });
    const count = await prisma.emailToken.count({
      where: { userId: user.id, purpose: 'RESET_PASSWORD', usedAt: null },
    });
    expect(count).toBe(1);
  });

  it('по ссылке пароль меняется: старый больше не подходит, новый работает', async () => {
    const { user } = await register('reset-a');
    const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: NEW_PASSWORD },
    });
    expect(reset.statusCode).toBe(200);

    const oldPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('reset-a'), password: PASSWORD },
    });
    expect(oldPw.statusCode).toBe(401);

    rateLimitClearAll();
    const newPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('reset-a'), password: NEW_PASSWORD },
    });
    expect(newPw.statusCode).toBe(200);
  });

  it('смена пароля выбрасывает уже выданные сессии', async () => {
    const { user, accessToken } = await register('reset-b');

    // Токен работает до смены
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(accessToken) });
    expect(before.statusCode).toBe(200);

    const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: NEW_PASSWORD },
    });

    /*
     * Ради этого всё и делается: пароль меняют, когда к учётной записи кто-то
     * получил доступ. Оставить его сессию живой — значит не решить задачу.
     */
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(accessToken) });
    expect(after.statusCode).toBe(401);
  });

  it('смена пароля заодно подтверждает адрес', async () => {
    const { user } = await register('reset-c');
    const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
    await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: NEW_PASSWORD },
    });

    // Человек доказал, что читает этот ящик — ровно то же, что доказывает
    // письмо подтверждения
    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } });
    expect(after?.emailVerified).not.toBeNull();
  });

  it('ссылка смены пароля срабатывает один раз', async () => {
    const { user } = await register('reset-d');
    const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: NEW_PASSWORD },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: 'ещё-один-пароль-123' },
    });
    expect(second.statusCode).toBe(400);
  });

  it('двое одновременно по одной ссылке — срабатывает один', async () => {
    const { user } = await register('reset-race');
    const token = await issueEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, newPassword: NEW_PASSWORD } }),
      app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, newPassword: 'третий-пароль-123' } }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
  });
});
