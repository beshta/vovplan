import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import prisma from './db/prisma.js';

/**
 * API-тесты через fastify.inject() — без поднятия порта.
 * БД — общий dev.db (SQLite); все данные помечены уникальным маркером
 * и подчищаются в afterAll.
 */

const marker = `apitest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'REDACTED-DEV-PASSWORD';

let app: FastifyInstance;
let masterToken = '';
let designerToken = '';
let outsiderToken = '';
let projectId = '';

async function register(who: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Test ${who}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json().accessToken as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  // Чистим всё, что создали (порядок: зависимые → корневые)
  if (projectId) {
    await prisma.comment.deleteMany({ where: { projectId } });
    await prisma.sceneObject.deleteMany({ where: { projectId } });
    await prisma.utilityNetwork.deleteMany({ where: { projectId } });
    await prisma.model3D.deleteMany({ where: { projectId } });
    await prisma.projectMember.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('health', () => {
  it('GET /health → 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

describe('auth', () => {
  it('регистрация → 201 + токен', async () => {
    masterToken = await register('master');
    expect(masterToken).toBeTruthy();
  });

  it('повторная регистрация того же email → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: emailOf('master'), password: PASSWORD, displayName: 'Dup' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('короткий пароль → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: emailOf('shortpw'), password: '123', displayName: 'Short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('логин → 200 + токен; неверный пароль → 401', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('master'), password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('master'), password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('GET /me с токеном → 200, без токена → 401', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(masterToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(emailOf('master'));

    const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('projects + роли', () => {
  it('создание проекта → 201, myRole=MASTER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth(masterToken),
      payload: {
        name: `Проект ${marker}`,
        description: 'API-тест',
        centerLat: 55.75,
        centerLng: 37.61,
        bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    projectId = body.id;
    expect(body.myRole).toBe('MASTER');
  });

  it('приглашение DESIGNER → 201', async () => {
    designerToken = await register('designer');
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: auth(masterToken),
      payload: { email: emailOf('designer'), role: 'DESIGNER' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('не-участник не видит проект (объекты → 404)', async () => {
    outsiderToken = await register('outsider');
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(outsiderToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('не-мастер не может приглашать участников → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      headers: auth(designerToken),
      payload: { email: emailOf('outsider'), role: 'SPECTATOR' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('scene objects: CRUD, права, soft-delete', () => {
  let designerObjId = '';
  let masterObjId = '';

  it('designer создаёт объект → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(designerToken),
      payload: { name: 'Сцена А', position: [1, 0, 2] },
    });
    expect(res.statusCode).toBe(201);
    designerObjId = res.json().id;
  });

  it('master создаёт объект → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(masterToken),
      payload: { name: 'Забор М', position: [5, 0, 5] },
    });
    expect(res.statusCode).toBe(201);
    masterObjId = res.json().id;
  });

  it('designer редактирует свой объект → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/objects/${designerObjId}`,
      headers: auth(designerToken),
      payload: { position: [3, 0, 4] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().position).toEqual([3, 0, 4]);
  });

  it('designer НЕ может редактировать чужой объект → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/objects/${masterObjId}`,
      headers: auth(designerToken),
      payload: { name: 'Взлом' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('designer «удаляет» свой объект → soft-delete (hidden)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/objects/${designerObjId}`,
      headers: auth(designerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hidden).toBe(true);
  });

  it('скрытый объект: designer не видит, master видит', async () => {
    const asDesigner = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(designerToken),
    });
    const designerIds = asDesigner.json().data.map((o: any) => o.id);
    expect(designerIds).not.toContain(designerObjId);

    const asMaster = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(masterToken),
    });
    const hidden = asMaster.json().data.find((o: any) => o.id === designerObjId);
    expect(hidden).toBeTruthy();
    expect(hidden.visible).toBe(false);
  });

  it('master восстанавливает скрытый объект → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objects/${designerObjId}/restore`,
      headers: auth(masterToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toBe(true);
  });

  it('master: удаление видимого → soft, повторное → hard (204)', async () => {
    const soft = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/objects/${masterObjId}`,
      headers: auth(masterToken),
    });
    expect(soft.statusCode).toBe(200);
    expect(soft.json().hidden).toBe(true);

    const hard = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/objects/${masterObjId}`,
      headers: auth(masterToken),
    });
    expect(hard.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(masterToken),
    });
    expect(list.json().data.map((o: any) => o.id)).not.toContain(masterObjId);
  });
});

describe('utility networks', () => {
  let utilId = '';

  it('создание сети → 201, дефолтный цвет по типу', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/utilities`,
      headers: auth(designerToken),
      payload: {
        name: 'Водовод-тест',
        type: 'WATER',
        location: 'UNDERGROUND',
        geometry: [[0, -1.5, 0], [10, -1.5, 10]],
        depth: 1.5,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    utilId = body.id;
    expect(body.color).toBe('#2563eb'); // синий — конвенция для воды
  });

  it('обновление сети → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/utilities/${utilId}`,
      headers: auth(designerToken),
      payload: { diameter: 160 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().diameter).toBe(160);
  });

  it('невалидная геометрия (1 точка) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/utilities`,
      headers: auth(designerToken),
      payload: {
        name: 'Bad',
        type: 'GAS',
        location: 'UNDERGROUND',
        geometry: [[0, 0, 0]],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('удаление сети → 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/utilities/${utilId}`,
      headers: auth(designerToken),
    });
    expect(res.statusCode).toBe(204);
  });
});
