import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Отзыв токенов.
 *
 * JWT нельзя аннулировать: он действителен до своего срока, а срок здесь
 * неделя. Пока поколения не было, смена пароля не выгоняла угонщика, токен
 * удалённого пользователя продолжал работать, а кнопка бана была бы
 * декоративной. Здесь проверяется, что теперь это не так.
 */

const marker = `revoketest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';
const NEW_PASSWORD = 'vitest-fixture-pw-2';

let app: FastifyInstance;
let url = '';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const me = (token: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });

async function freshUser(who: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Test ${who}` },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  return { token: body.accessToken, id: body.user.id };
}

/** Пробуем открыть сокет; отдаём true, если пустили */
function socketAccepted(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = connect(url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const done = (ok: boolean) => {
      socket.disconnect();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('connect_error', () => done(false));
    setTimeout(() => done(false), 3000);
  });
}

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

beforeEach(() => rateLimitClearAll());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('отзыв токенов', () => {
  it('обычный токен работает', async () => {
    const { token } = await freshUser('plain');
    expect((await me(token)).statusCode).toBe(200);
  });

  it('смена пароля обесценивает прежние токены', async () => {
    const { token } = await freshUser('changer');
    // Второе устройство с тем же токеном — его и должно выбить
    const otherDevice = token;

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: auth(token),
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(200);

    expect((await me(otherDevice)).statusCode).toBe(401);
  });

  it('текущая вкладка получает новый токен и продолжает работать', async () => {
    const { token } = await freshUser('keeper');
    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: auth(token),
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    // Иначе человек, меняя пароль, выгонял бы заодно и себя
    const renewed = changed.json().accessToken as string;
    expect(renewed).toBeTruthy();
    expect((await me(renewed)).statusCode).toBe(200);
  });

  it('прямой отзыв выбивает пользователя', async () => {
    const { token, id } = await freshUser('revoked');
    expect((await me(token)).statusCode).toBe(200);

    // Ровно это будет делать кнопка бана в админке
    await app.revokeTokens(id);

    expect((await me(token)).statusCode).toBe(401);
  });

  it('токен удалённого пользователя перестаёт работать', async () => {
    const { token, id } = await freshUser('deleted');
    expect((await me(token)).statusCode).toBe(200);

    await prisma.user.delete({ where: { id } });

    expect((await me(token)).statusCode).toBe(401);
  });

  /*
   * Токены, выпущенные до введения поколений, поля `ver` не содержат вовсе, и
   * приниматься не должны. Это осознанный размен: при выкатке все разом
   * оказываются разлогинены и входят заново — один раз. Обратная совместимость
   * («нет поля — считаем нулём») жила бы в коде вечно и оставляла бы годными
   * все старые токены, а именно от них и хочется избавиться.
   */
  it('токен без поколения не принимается', async () => {
    const { id } = await freshUser('legacy');
    const legacy = app.jwt.sign({ userId: id, email: emailOf('legacy') } as never);
    expect((await me(legacy)).statusCode).toBe(401);
  });

  it('отозванный токен не открывает и сокет', async () => {
    const { token, id } = await freshUser('socket');
    expect(await socketAccepted(token)).toBe(true);

    await app.revokeTokens(id);

    // Подпись у токена по-прежнему верная — не пустить должно поколение
    expect(await socketAccepted(token)).toBe(false);
  });
});
