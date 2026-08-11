import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Ограничение попыток входа.
 *
 * Прежний счёт шёл только по адресу источника, а за обратным прокси он один на
 * всех: десять неудачных входов закрывали вход всему сервису, и при этом
 * подбор пароля с нескольких адресов не останавливался вовсе. Смысл здешних
 * проверок — что счёт привязан к учётной записи, а не к адресу и не к сервису
 * целиком.
 */

const marker = `ratetest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';
const WRONG = 'definitely-not-the-password';

/**
 * Несуществующая почта: вход отвечает 401 сразу, не доходя до bcrypt.
 * Счётчик учётной записи ведётся по присланному адресу независимо от того,
 * есть такой пользователь или нет, — так перебор не подсказывает, какие
 * почты заведены. Заодно набор не тратит по полторы секунды на хэши там,
 * где проверяется только счёт.
 */
const UNKNOWN = `nobody.${marker}@test.vovplan.io`;

let app: FastifyInstance;

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
  for (const who of ['victim', 'bystander']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: emailOf(who), password: PASSWORD, displayName: `Test ${who}` },
    });
    expect(res.statusCode).toBe(201);
  }
});

beforeEach(() => rateLimitClearAll());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('ограничение попыток входа', () => {
  it('после восьми неудач по учётной записи девятая отбивается', async () => {
    for (let i = 0; i < 8; i++) {
      expect((await login(UNKNOWN, WRONG)).statusCode).toBe(401);
    }
    const blocked = await login(UNKNOWN, WRONG);
    expect(blocked.statusCode).toBe(429);
    expect(JSON.parse(blocked.body).message).toContain('Слишком много попыток');
  });

  it('заблокированной учётной записи не помогает и верный пароль', async () => {
    for (let i = 0; i < 9; i++) await login(emailOf('victim'), WRONG);
    // Иначе подбор шёл бы дальше: угадал — и предел уже не важен
    expect((await login(emailOf('victim'), PASSWORD)).statusCode).toBe(429);
  });

  /*
   * Главная проверка. При прежнем счёте по адресу оба пользователя сидели бы в
   * одном ведре — с одного адреса идут все запросы, — и посторонний оказался бы
   * заперт вместе с жертвой. Именно так и выглядела блокировка всего сервиса.
   */
  it('блокировка одной учётной записи не задевает остальных', async () => {
    for (let i = 0; i < 9; i++) await login(UNKNOWN, WRONG);
    expect((await login(UNKNOWN, WRONG)).statusCode).toBe(429);

    const other = await login(emailOf('bystander'), PASSWORD);
    expect(other.statusCode).toBe(200);
  });

  it('счётчик не обойти сменой регистра в почте', async () => {
    for (let i = 0; i < 8; i++) await login(UNKNOWN, WRONG);
    expect((await login(UNKNOWN.toUpperCase(), WRONG)).statusCode).toBe(429);
  });

  it('успешный вход снимает накопленные неудачи', async () => {
    for (let i = 0; i < 5; i++) await login(emailOf('victim'), WRONG);
    expect((await login(emailOf('victim'), PASSWORD)).statusCode).toBe(200);

    // Счётчик обнулён — снова доступны все восемь попыток
    for (let i = 0; i < 8; i++) {
      expect((await login(emailOf('victim'), WRONG)).statusCode).toBe(401);
    }
  });
});
