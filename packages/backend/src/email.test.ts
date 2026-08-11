import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import { normalizeEmail } from './utils/email.js';
import prisma from './db/prisma.js';

/**
 * `Vova@Mail.ru` и `vova@mail.ru` — один ящик, но для базы две разные строки,
 * и на них заводились два разных аккаунта.
 *
 * Отдельно проверяется запасной путь для тех, кто зарегистрировался до этой
 * правки: у них в базе лежит адрес с заглавными, и поиск только по строчной
 * запер бы их снаружи. Правка ради порядка не имеет права никого выгонять.
 */

const marker = `emailtest-${Date.now()}`;
const PASSWORD = 'vitest-fixture-pw-1';

let app: FastifyInstance;

const register = (email: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Тест' },
  });

const login = (email: string, password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('приведение почты', () => {
  it('регистр не создаёт второй аккаунт', async () => {
    const lower = `mixed.${marker}@test.vovplan.io`;
    const upper = lower.toUpperCase();

    expect((await register(lower)).statusCode).toBe(201);
    const second = await register(upper);
    expect(second.statusCode).toBe(409);
  });

  it('войти можно набрав адрес как угодно', async () => {
    const email = `case.${marker}@test.vovplan.io`;
    expect((await register(email)).statusCode).toBe(201);

    expect((await login(email)).statusCode).toBe(200);
    expect((await login(email.toUpperCase())).statusCode).toBe(200);
    expect((await login(`  ${email}  `)).statusCode).toBe(200);
  });

  it('адрес сохраняется в нижнем регистре', async () => {
    const email = `Stored.${marker}@Test.Vovplan.IO`;
    const res = await register(email);
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe(normalizeEmail(email));
  });

  /*
   * Самое важное: аккаунт, заведённый до нормализации. Такую запись создаём
   * прямо в базе, потому что через регистрацию её уже не сделать.
   */
  it('заведённый до правки аккаунт с заглавными продолжает входить', async () => {
    const legacy = `Legacy.${marker}@Test.Vovplan.IO`;
    await prisma.user.create({
      data: {
        email: legacy,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        displayName: 'Старый',
      },
    });

    const res = await login(legacy);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(legacy);
  });

  it('на занятый старый адрес нельзя зарегистрироваться заново', async () => {
    const legacy = `Dup.${marker}@Test.Vovplan.IO`;
    await prisma.user.create({
      data: {
        email: legacy,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        displayName: 'Старый',
      },
    });

    // Ни как есть, ни в нижнем регистре — иначе получилась бы вторая учётка
    // на тот же ящик, ровно та беда, от которой уходим
    expect((await register(legacy)).statusCode).toBe(409);
    expect((await register(legacy.toLowerCase())).statusCode).toBe(409);
  });
});
