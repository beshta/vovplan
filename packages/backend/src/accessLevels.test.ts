import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Secret, TOTP } from 'otpauth';
import { AccountLevel } from '@prisma/client';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Уровень доступа и управление проектами.
 *
 * Проверяется не «работает ли», а «не пускает ли»: уровень — это предел, и
 * ценность у него ровно в тех случаях, когда его пытаются перешагнуть.
 * Отдельная забота — мягкое удаление: проект, убранный из списка, но
 * доступный по прямой ссылке, хуже, чем не убранный вовсе, потому что все
 * считают его удалённым.
 *
 * Каждый тест прогнан на коде до этой правки и там падает.
 */

const marker = `leveltest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';
const UPLOAD_DIR = join(process.cwd(), 'uploads');

let app: FastifyInstance;
let adminToken = '';
let adminId = '';
let masterToken = '';
let masterId = '';
let guestToken = '';
let guestId = '';
let totpSecret = '';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const withPass = (jwt: string, pass: string) => ({
  authorization: `Bearer ${jwt}`,
  'x-admin-token': pass,
});

const realNow = Date.now.bind(Date);
let shift = 0;

async function register(who: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Тест ${who}` },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().accessToken, id: res.json().user.id };
}

async function createProject(token: string, name: string) {
  return app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: auth(token),
    payload: {
      name: `${name} ${marker}`,
      centerLat: 55.75,
      centerLng: 37.61,
      bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
    },
  });
}

const setLevel = (userId: string, level: AccountLevel) =>
  prisma.user.update({ where: { id: userId }, data: { accountLevel: level } });

/** Свежий пропуск в админку: код действует минуту и повторно не принимается */
async function openSession(): Promise<string> {
  shift += 60_000;
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/session',
    headers: auth(adminToken),
    payload: {
      code: new TOTP({
        issuer: 'VOVPLAN',
        label: 'x',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(totpSecret),
      }).generate({ timestamp: Date.now() }),
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().adminToken;
}

beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + shift);

  app = await buildServer({ logger: false });
  await app.ready();

  const admin = await register('admin');
  adminToken = admin.token;
  adminId = admin.id;

  const master = await register('master');
  masterToken = master.token;
  masterId = master.id;

  const guest = await register('guest');
  guestToken = guest.token;
  guestId = guest.id;

  await prisma.user.update({ where: { id: adminId }, data: { isAdmin: true } });

  const setup = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/totp/setup',
    headers: auth(adminToken),
  });
  totpSecret = setup.json().secret;
  const enable = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/totp/enable',
    headers: auth(adminToken),
    payload: {
      code: new TOTP({
        issuer: 'VOVPLAN',
        label: 'x',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(totpSecret),
      }).generate({ timestamp: Date.now() }),
    },
  });
  expect(enable.statusCode).toBe(200);
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
  const users = await prisma.user.findMany({
    where: { email: { contains: marker } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.adminAction.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.totpBackupCode.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
  vi.restoreAllMocks();
});

describe('уровень как предел на свои проекты', () => {
  it('мастер упирается в третий проект, а безлимитный — нет', async () => {
    await setLevel(masterId, AccountLevel.MASTER);

    for (const n of [1, 2, 3]) {
      const res = await createProject(masterToken, `Проект ${n}`);
      expect(res.statusCode).toBe(201);
    }

    const fourth = await createProject(masterToken, 'Проект 4');
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json().error).toBe('LEVEL_LIMIT');

    // Тот же человек с безлимитным уровнем создаёт четвёртый без разговоров
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const again = await createProject(masterToken, 'Проект 4');
    expect(again.statusCode).toBe(201);

    await setLevel(masterId, AccountLevel.MASTER);
  });

  it('проектировщику своих проектов не полагается вовсе', async () => {
    await setLevel(guestId, AccountLevel.DESIGNER);

    const res = await createProject(guestToken, 'Не мой');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('LEVEL_FORBIDDEN');
  });

  it('удалённый проект не занимает место в пределе', async () => {
    await setLevel(guestId, AccountLevel.MASTER);
    const first = await createProject(guestToken, 'Занимает место');
    expect(first.statusCode).toBe(201);

    await prisma.user.update({ where: { id: guestId }, data: { accountLevel: AccountLevel.MASTER } });
    await app.inject({
      method: 'DELETE',
      url: `/api/projects/${first.json().id}`,
      headers: auth(guestToken),
    });

    const quota = await app.inject({ method: 'GET', url: '/api/projects/quota', headers: auth(guestToken) });
    expect(quota.json()).toEqual({ used: 0, limit: 3 });
  });
});

describe('уровень как потолок роли в чужом проекте', () => {
  let projectId = '';

  beforeAll(async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const res = await createProject(masterToken, 'Чужой');
    projectId = res.json().id;
    await setLevel(masterId, AccountLevel.MASTER);
  });

  it('зрителя нельзя позвать проектировщиком', async () => {
    await setLevel(guestId, AccountLevel.SPECTATOR);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: auth(masterToken),
      payload: { email: emailOf('guest'), role: 'DESIGNER' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('LEVEL_FORBIDDEN');
  });

  it('в свой потолок он входит', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: auth(masterToken),
      payload: { email: emailOf('guest'), role: 'SPECTATOR' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('потолок не обойти приглашением по ссылке', async () => {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/invites`,
      headers: auth(masterToken),
      payload: { role: 'DESIGNER' },
    });
    expect(invite.statusCode).toBe(201);

    const outsider = await register('outsider');
    await setLevel(outsider.id, AccountLevel.SPECTATOR);

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/invites/${invite.json().token}/accept`,
      headers: auth(outsider.token),
    });
    expect(accepted.statusCode).toBe(403);
    expect(accepted.json().error).toBe('LEVEL_FORBIDDEN');

    // Отказ не должен сжигать вход по ссылке: следующему она ещё пригодится
    const inv = await prisma.invite.findUnique({ where: { token: invite.json().token } });
    expect(inv?.usedCount).toBe(0);
  });
});

describe('корзина вместо удаления', () => {
  let projectId = '';
  let memberToken = '';

  beforeAll(async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const res = await createProject(masterToken, 'На удаление');
    projectId = res.json().id;

    const member = await register('member');
    memberToken = member.token;
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: auth(masterToken),
      payload: { email: emailOf('member'), role: 'DESIGNER' },
    });
  });

  it('после удаления проект остаётся в базе, но исчезает у всех', async () => {
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}`,
      headers: auth(masterToken),
    });
    expect(deleted.statusCode).toBe(204);

    const row = await prisma.project.findUnique({ where: { id: projectId } });
    expect(row?.deletedAt).not.toBeNull();

    // Ни у хозяина проекта, ни у участника — ни в списке, ни по прямой ссылке
    for (const token of [masterToken, memberToken]) {
      const list = await app.inject({ method: 'GET', url: '/api/projects', headers: auth(token) });
      expect(list.json().data.map((p: { id: string }) => p.id)).not.toContain(projectId);

      const direct = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}`,
        headers: auth(token),
      });
      expect(direct.statusCode).toBe(404);
    }
  });

  it('сцена удалённого проекта тоже закрыта', async () => {
    const scene = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/scene`,
      headers: auth(memberToken),
    });
    expect(scene.statusCode).toBe(404);
  });

  it('восстановление из админки возвращает доступ участнику', async () => {
    const pass = await openSession();
    const restored = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${projectId}/restore`,
      headers: withPass(adminToken, pass),
    });
    expect(restored.statusCode).toBe(200);

    const direct = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: auth(memberToken),
    });
    expect(direct.statusCode).toBe(200);
  });
});

describe('окончательное удаление', () => {
  it('сносит проект вместе с папкой в uploads, и только из корзины', async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const created = await createProject(masterToken, 'Навсегда');
    const projectId = created.json().id;

    const dir = join(UPLOAD_DIR, projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'model.glb'), 'x');

    const pass = await openSession();

    // Живой проект стереть нельзя: сначала корзина, и это два разных действия
    const early = await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}/purge`,
      headers: withPass(adminToken, pass),
    });
    expect(early.statusCode).toBe(409);

    await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}`,
      headers: withPass(adminToken, pass),
    });
    const purged = await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}/purge`,
      headers: withPass(adminToken, pass),
    });
    expect(purged.statusCode).toBe(200);

    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    await expect(access(dir)).rejects.toThrow();
  });

  it('без свежего кода не стирает', async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const created = await createProject(masterToken, 'Не стёртый');
    const projectId = created.json().id;

    const pass = await openSession();
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}`,
      headers: withPass(adminToken, pass),
    });

    // Пропуск живёт полчаса, свежесть — пять минут: вкладка, оставленная
    // открытой, стирать чужую работу не должна
    shift += 6 * 60_000;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}/purge`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('STEP_UP_REQUIRED');
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
  });
});

describe('публичный проект и витрина', () => {
  let projectId = '';

  beforeAll(async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const res = await createProject(masterToken, 'Публичный');
    projectId = res.json().id;
  });

  it('закрытый проект посторонним не отдаётся, даже если знать адрес', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/public/projects/${projectId}` });
    expect(res.statusCode).toBe(404);
  });

  it('открытый — отдаётся без входа, но без лишнего', async () => {
    const pass = await openSession();
    const opened = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${projectId}/public`,
      headers: withPass(adminToken, pass),
    });
    expect(opened.statusCode).toBe(200);

    const fence = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(masterToken),
      payload: {
        name: 'Периметр',
        type: 'MESH_3D',
        geometry: [[0, 0, 0], [10, 0, 0], [10, 0, 10]],
      },
    });
    expect(fence.statusCode).toBe(201);

    const res = await app.inject({ method: 'GET', url: `/api/public/projects/${projectId}` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.project.name).toContain('Публичный');
    // Набор полей обязан совпадать с share-ссылкой: ни сетей, ни комментариев.
    // Заборы — часть внешнего вида, они здесь есть.
    expect(Object.keys(body).sort()).toEqual(
      ['fences', 'models', 'objects', 'presets', 'project', 'startPresetId'].sort(),
    );
    expect(body.fences).toHaveLength(1);
    expect(body.fences[0]).toMatchObject({ name: 'Периметр', type: 'MESH_3D' });
    expect(body.fences[0]).not.toHaveProperty('authorId');
  });

  it('витрина пуста, пока проект на неё не поставили', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/featured' });
    expect(res.statusCode).toBe(200);
    // На витрине может висеть чужой проект из этой же базы — нам важно,
    // что нашего там ещё нет
    expect(res.json().projectId ?? null).not.toBe(projectId);
  });

  it('на витрину попадает поставленный проект', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${projectId}/feature`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);

    const featured = await app.inject({ method: 'GET', url: '/api/public/featured' });
    expect(featured.json().projectId).toBe(projectId);
  });

  it('снятие публичности убирает и с витрины', async () => {
    const pass = await openSession();
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/projects/${projectId}/public`,
      headers: withPass(adminToken, pass),
    });

    const featured = await app.inject({ method: 'GET', url: '/api/public/featured' });
    expect(featured.json().projectId ?? null).not.toBe(projectId);

    const direct = await app.inject({ method: 'GET', url: `/api/public/projects/${projectId}` });
    expect(direct.statusCode).toBe(404);
  });

  it('закрытый проект на витрину не ставится', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${projectId}/feature`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(409);
  });

  it('удалённый проект пропадает и из публичного доступа', async () => {
    const pass = await openSession();
    await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${projectId}/public`,
      headers: withPass(adminToken, pass),
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}`,
      headers: auth(masterToken),
    });

    const res = await app.inject({ method: 'GET', url: `/api/public/projects/${projectId}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('смена уровня из админки', () => {
  it('меняет уровень, требует свежего кода и остаётся в журнале', async () => {
    const pass = await openSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${guestId}/level`,
      headers: withPass(adminToken, pass),
      payload: { level: AccountLevel.SUPER_SPECTATOR },
    });
    expect(res.statusCode).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: guestId } });
    expect(user?.accountLevel).toBe(AccountLevel.SUPER_SPECTATOR);

    const logged = await prisma.adminAction.findFirst({
      where: { action: 'admin.level', targetUserId: guestId },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged).not.toBeNull();
    expect(logged?.details).toMatchObject({ to: AccountLevel.SUPER_SPECTATOR });
  });

  it('несуществующий уровень не принимается', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${guestId}/level`,
      headers: withPass(adminToken, pass),
      payload: { level: 'GOD_MODE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('посторонний уровни не раздаёт', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${guestId}/level`,
      headers: auth(masterToken),
      payload: { level: AccountLevel.MASTER_UNLIMITED },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('список проектов в админке', () => {
  it('корзина показывается отдельным фильтром, а не вперемешку', async () => {
    const pass = await openSession();

    const all = await app.inject({
      method: 'GET',
      url: `/api/admin/projects?query=${encodeURIComponent(marker)}`,
      headers: withPass(adminToken, pass),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.every((p: { deletedAt: string | null }) => p.deletedAt === null)).toBe(true);

    const deleted = await app.inject({
      method: 'GET',
      url: `/api/admin/projects?filter=deleted&query=${encodeURIComponent(marker)}`,
      headers: withPass(adminToken, pass),
    });
    expect(deleted.json().data.length).toBeGreaterThan(0);
    expect(deleted.json().data.every((p: { deletedAt: string | null }) => p.deletedAt !== null)).toBe(true);
  });

  it('в строке видно хозяина проекта', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/projects?query=${encodeURIComponent(marker)}`,
      headers: withPass(adminToken, pass),
    });
    const row = res.json().data[0];
    expect(row.owner).not.toBeNull();
    expect(typeof row.bytes).toBe('number');
  });
});

describe('тихий просмотр из админки', () => {
  it('закрытый проект отдаётся с пропуском и не как публичный', async () => {
    await setLevel(masterId, AccountLevel.MASTER_UNLIMITED);
    const created = await createProject(masterToken, 'Закрытый для осмотра');
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const asPublic = await app.inject({ method: 'GET', url: `/api/public/projects/${id}` });
    expect(asPublic.statusCode).toBe(404);

    const asMember = await app.inject({
      method: 'GET',
      url: `/api/admin/projects/${id}/preview`,
      headers: auth(masterToken),
    });
    expect(asMember.statusCode).toBe(404);

    const pass = await openSession();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/projects/${id}/preview`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.name).toContain('Закрытый для осмотра');
    expect(Array.isArray(res.json().fences)).toBe(true);

    const logged = await prisma.adminAction.findFirst({
      where: { action: 'admin.project-inspect' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged?.details).toMatchObject({ projectId: id });
  });
});
