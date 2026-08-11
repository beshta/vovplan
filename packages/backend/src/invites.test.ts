import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Приглашение по ссылке — это дверь в чужой проект, и открыта она ровно
 * столько, сколько разрешено. Раньше ссылка по умолчанию была бессрочной и
 * многоразовой: одна утёкшая переписка пускала посторонних хоть через год.
 *
 * Проверяется и гонка: двое, перешедшие по одноразовой ссылке одновременно,
 * не должны войти оба.
 */

const marker = `invitetest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';

let app: FastifyInstance;
let masterToken = '';
let projectId = '';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(who: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Test ${who}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json().accessToken as string;
}

async function makeInvite(body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/invites`,
    headers: auth(masterToken),
    payload: { role: 'SPECTATOR', ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const accept = (token: string, userToken: string) =>
  app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, headers: auth(userToken) });

beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();

  masterToken = await register('master');
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: auth(masterToken),
    payload: {
      name: `Приглашения ${marker}`,
      centerLat: 55.75,
      centerLng: 37.61,
      bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
    },
  });
  expect(created.statusCode).toBe(201);
  projectId = created.json().id;
});

afterAll(async () => {
  const mine = await prisma.project.findMany({
    where: { name: { contains: marker } },
    select: { id: true },
  });
  for (const { id } of mine) {
    await prisma.invite.deleteMany({ where: { projectId: id } });
    await prisma.activityEvent.deleteMany({ where: { projectId: id } });
    await prisma.projectMember.deleteMany({ where: { projectId: id } });
    await prisma.project.deleteMany({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('приглашения по ссылке', () => {
  it('по умолчанию ссылка получает срок, а не живёт вечно', async () => {
    const inv = await makeInvite({});
    expect(inv.expiresAt).not.toBeNull();
    const days = (new Date(inv.expiresAt).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it('одноразовая ссылка пускает одного и закрывается', async () => {
    const inv = await makeInvite({ maxUses: 1 });
    const first = await register('one-a');
    const second = await register('one-b');

    expect((await accept(inv.token, first)).statusCode).toBe(200);

    const denied = await accept(inv.token, second);
    expect(denied.statusCode).toBe(410);

    // И страница приглашения честно говорит, что дверь закрыта
    const info = await app.inject({ method: 'GET', url: `/api/invites/${inv.token}` });
    expect(info.statusCode).toBe(410);
  });

  it('двое одновременно по одноразовой ссылке — входит ровно один', async () => {
    const inv = await makeInvite({ maxUses: 1 });
    const a = await register('race-a');
    const b = await register('race-b');

    const [ra, rb] = await Promise.all([accept(inv.token, a), accept(inv.token, b)]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    expect(codes).toEqual([200, 410]);

    const members = await prisma.projectMember.count({ where: { projectId } });
    // мастер + ровно один вошедший из этого теста + вошедшие в предыдущих
    const fresh = await prisma.projectMember.findMany({
      where: { projectId, user: { email: { contains: `race-` } } },
    });
    expect(fresh).toHaveLength(1);
    expect(members).toBeGreaterThan(0);
  });

  it('повторный переход участника не съедает вход у следующего', async () => {
    const inv = await makeInvite({ maxUses: 2 });
    const first = await register('again-a');
    const second = await register('again-b');

    expect((await accept(inv.token, first)).statusCode).toBe(200);
    // тот же человек ещё раз — идемпотентно и без списания
    const repeat = await accept(inv.token, first);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().already).toBe(true);

    // значит второму место осталось
    expect((await accept(inv.token, second)).statusCode).toBe(200);
  });

  it('без ограничения по числу входят несколько', async () => {
    const inv = await makeInvite({});
    const a = await register('many-a');
    const b = await register('many-b');
    expect((await accept(inv.token, a)).statusCode).toBe(200);
    expect((await accept(inv.token, b)).statusCode).toBe(200);
  });

  it('истёкшая ссылка не пускает', async () => {
    const inv = await makeInvite({ expiresDays: 1 });
    await prisma.invite.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const user = await register('late');
    expect((await accept(inv.token, user)).statusCode).toBe(410);
  });
});
