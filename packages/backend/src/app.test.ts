import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * API-тесты через fastify.inject() — без поднятия порта.
 * БД — общий dev.db (SQLite); все данные помечены уникальным маркером
 * и подчищаются в afterAll.
 */

const marker = `apitest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';

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

// Счётчики ограничителя общие для процесса: без сброса тесты
// упрутся в лимит входа и начнут падать с 429
beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  // Чистим всё, что создали (порядок: зависимые → корневые).
  // Проектов за прогон появляется несколько, поэтому ищем их по метке, а не по
  // одной переменной: забытый проект держит участников, а те — пользователей,
  // и удаление падает на внешнем ключе уже после того, как все тесты прошли.
  const mine = await prisma.project.findMany({
    where: { name: { contains: marker } },
    select: { id: true },
  });
  for (const { id: projectId } of mine) {
    await prisma.shareLink.deleteMany({ where: { projectId } });
    await prisma.cameraPreset.deleteMany({ where: { projectId } });
    await prisma.comment.deleteMany({ where: { projectId } });
    await prisma.sceneObject.deleteMany({ where: { projectId } });
    await prisma.utilityNetwork.deleteMany({ where: { projectId } });
    await prisma.fence.deleteMany({ where: { projectId } });
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

describe('fences', () => {
  let fenceId = '';

  it('создание ограждения → 201, контур по умолчанию разомкнут', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(designerToken),
      payload: {
        name: 'Периметр-тест',
        type: 'MESH_3D',
        geometry: [[0, 0, 0], [20, 0, 0], [20, 0, 20]],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    fenceId = body.id;
    expect(body.closed).toBe(false);
    // Высоту не передавали — тип сам задаёт типовую, в базе её нет
    expect(body.height).toBeNull();
  });

  it('список отдаёт созданное ограждение', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(designerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((f: any) => f.id)).toContain(fenceId);
  });

  it('замыкание контура и смена типа → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/fences/${fenceId}`,
      headers: auth(designerToken),
      payload: { closed: true, type: 'CONCRETE', height: 2.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ closed: true, type: 'CONCRETE', height: 2.5 });
  });

  // Забор в шесть метров — уже не забор, а стена поперёк всей сцены
  it('высота вне разумного диапазона → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(designerToken),
      payload: { name: 'Стена', type: 'CONCRETE', geometry: [[0, 0, 0], [5, 0, 0]], height: 12 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('одна точка — не ломаная → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(designerToken),
      payload: { name: 'Bad', type: 'FAN_BARRIER', geometry: [[0, 0, 0]] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('посторонний не видит и не ставит ограждения → 404', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(outsiderToken),
    });
    expect(list.statusCode).toBe(404);

    const create = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/fences`,
      headers: auth(outsiderToken),
      payload: { name: 'Чужой', type: 'FAN_BARRIER', geometry: [[0, 0, 0], [5, 0, 0]] },
    });
    expect(create.statusCode).toBe(404);
  });

  it('удаление ограждения → 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/fences/${fenceId}`,
      headers: auth(designerToken),
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('Фаза 7: пресеты камеры + share-ссылки', () => {
  let presetId = '';
  let shareToken = '';
  let shareId = '';

  it('designer создаёт пресет → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/presets`,
      headers: auth(designerToken),
      payload: { name: 'Вид с юга', position: [40, 45, 40], target: [0, 0, 0] },
    });
    expect(res.statusCode).toBe(201);
    presetId = res.json().id;
  });

  it('master создаёт share-ссылку с пресетом → 201, url-safe токен', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/shares`,
      headers: auth(masterToken),
      payload: { name: 'Для подрядчика', presetId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    shareToken = body.token;
    shareId = body.id;
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(body.presetId).toBe(presetId);
  });

  it('designer НЕ может создавать share-ссылки → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/shares`,
      headers: auth(designerToken),
      payload: { name: 'Хакерская' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('публичный GET /api/shared/:token — без авторизации, без сетей и скрытого', async () => {
    // создаём утилити-сеть и скрытый объект, чтобы проверить фильтрацию
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/utilities`,
      headers: auth(masterToken),
      payload: { name: 'Секретный газ', type: 'GAS', location: 'UNDERGROUND', geometry: [[0, -2, 0], [5, -2, 5]] },
    });
    const hiddenObj = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/objects`,
      headers: auth(masterToken),
      payload: { name: 'Скрытый склад', position: [9, 0, 9] },
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/objects/${hiddenObj.json().id}`,
      headers: auth(masterToken),
    }); // soft-delete → visible=false

    const res = await app.inject({ method: 'GET', url: `/api/shared/${shareToken}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.project.name).toContain('Проект');
    expect(body.startPresetId).toBe(presetId);
    expect(body.presets.map((p: any) => p.id)).toContain(presetId);
    // только видимые объекты
    const names = body.objects.map((o: any) => o.name);
    expect(names).toContain('Сцена А');
    expect(names).not.toContain('Скрытый склад');
    // инженерных данных и авторских id в ответе нет вообще
    const raw = res.body;
    expect(raw).not.toContain('Секретный газ');
    expect(raw).not.toContain('utilities');
    expect(raw).not.toContain('authorId');
  });

  it('невалидный токен → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shared/no-such-token' });
    expect(res.statusCode).toBe(404);
  });

  it('просроченная ссылка → 410', async () => {
    const expired = await prisma.shareLink.create({
      data: {
        projectId,
        token: `expired-${marker}`,
        name: 'Просроченная',
        expiresAt: new Date(Date.now() - 1000),
        createdById: 'test',
      },
    });
    const res = await app.inject({ method: 'GET', url: `/api/shared/${expired.token}` });
    expect(res.statusCode).toBe(410);
  });

  it('отзыв ссылки мастером → 204, токен перестаёт работать', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/shares/${shareId}`,
      headers: auth(masterToken),
    });
    expect(del.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: `/api/shared/${shareToken}` });
    expect(res.statusCode).toBe(404);
  });
});

// Ограничение попыток входа проверяется в rateLimit.test.ts — целиком, вместе
// с привязкой счёта к учётной записи. Здесь этого блока больше нет намеренно:
// пороги, записанные в двух местах, разъезжаются при первой же правке, что и
// произошло, когда счёт перевели с адреса на учётную запись.

describe('правка рельефа', () => {
  /**
   * Настройка живёт внутри terrainMeta, а не в своей колонке: три числа не
   * окупают правку обеих схем Prisma. Значит важно проверить, что она
   * действительно доезжает до базы и не сносит остальные данные о рельефе.
   */
  let terrainProject = '';

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth(masterToken),
      payload: {
        name: `Рельеф ${marker}`,
        description: 'правка высот',
        centerLat: 55.75,
        centerLng: 37.61,
        bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
      },
    });
    expect(res.statusCode).toBe(201);
    terrainProject = res.json().id;
  });

  it('без загруженного рельефа → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${terrainProject}/terrain/adjust`,
      headers: auth(masterToken),
      payload: { smooth: 0, level: 0, scale: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('значения вне допустимого → 400', async () => {
    // Отрицательный масштаб вывернул бы рельеф наизнанку
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${terrainProject}/terrain/adjust`,
      headers: auth(masterToken),
      payload: { smooth: 0, level: 0, scale: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('сохраняет правку и не теряет остальные данные о рельефе', async () => {
    const prisma = (await import('./db/prisma.js')).default;
    await prisma.project.update({
      where: { id: terrainProject },
      data: {
        terrainUrl: '/uploads/x/terrain/h.png',
        terrainMeta: { textureUrl: '/t.jpg', widthM: 200, heightM: 200, minElev: 10, maxElev: 20 } as any,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${terrainProject}/terrain/adjust`,
      headers: auth(masterToken),
      payload: { smooth: 12, level: 0.5, scale: 0.75 },
    });
    expect(res.statusCode).toBe(200);

    const meta = res.json().terrainMeta;
    expect(meta.adjust).toEqual({ smooth: 12, level: 0.5, scale: 0.75 });
    // Снимок высот и размеры площадки должны остаться на месте
    expect(meta.widthM).toBe(200);
    expect(meta.textureUrl).toBe('/t.jpg');
  });

  it('наблюдатель править рельеф не может → 403', async () => {
    const viewer = await register('terrain-viewer');
    const invited = await app.inject({
      method: 'POST',
      url: `/api/projects/${terrainProject}/members`,
      headers: auth(masterToken),
      payload: { email: emailOf('terrain-viewer'), role: 'SPECTATOR' },
    });
    expect(invited.statusCode).toBe(201);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${terrainProject}/terrain/adjust`,
      headers: auth(viewer),
      payload: { smooth: 0, level: 0, scale: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('посторонний не узнаёт даже о существовании проекта → 404', async () => {
    // Права проверяются раньше всего, и чужому проект не показывается вовсе
    const stranger = await register('terrain-stranger');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${terrainProject}/terrain/adjust`,
      headers: auth(stranger),
      payload: { smooth: 0, level: 0, scale: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('загрузка моделей', () => {
  /**
   * Разбор multipart обязан вычитывать поток файла сразу, а не откладывать
   * часть «на потом»: иначе разбор встаёт и ответа нет вовсе. Работало это
   * ровно до тех пор, пока файл помещался во внутренний буфер, поэтому на
   * десяти килобайтах ничего не ловилось — нужен файл заведомо больше.
   */
  let modelProject = '';
  const CRLF = '\r\n';

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth(masterToken),
      payload: {
        name: `Модели ${marker}`,
        description: 'загрузка',
        centerLat: 55.75,
        centerLng: 37.61,
        bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
      },
    });
    expect(res.statusCode).toBe(201);
    modelProject = res.json().id;
  });

  /**
   * Тело multipart руками: inject не умеет FormData.
   * `nameFirst` — порядок полей, его задаёт браузер, и файл вполне может идти
   * первым; для разбора это принципиально разные случаи.
   */
  const upload = (opts: { size: number; name?: string; filename?: string; nameFirst?: boolean }) => {
    const b = `----vovplan${Math.random().toString(36).slice(2)}`;
    const namePart = opts.name
      ? `--${b}${CRLF}Content-Disposition: form-data; name="name"${CRLF}${CRLF}${opts.name}${CRLF}`
      : '';
    const fileHead =
      `--${b}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${opts.filename ?? 'model.glb'}"${CRLF}` +
      `Content-Type: model/gltf-binary${CRLF}${CRLF}`;

    const head = Buffer.from(opts.nameFirst === false ? fileHead : namePart + fileHead);
    const tail = Buffer.from(
      (opts.nameFirst === false ? CRLF + namePart.replace(`--${b}${CRLF}`, `--${b}${CRLF}`) : CRLF) +
        `--${b}--${CRLF}`,
    );

    return app.inject({
      method: 'POST',
      url: `/api/projects/${modelProject}/models`,
      headers: { ...auth(masterToken), 'content-type': `multipart/form-data; boundary=${b}` },
      payload: Buffer.concat([head, Buffer.alloc(opts.size, 7), tail]),
    });
  };

  it('файл в мегабайт доходит целиком', async () => {
    const size = 1024 * 1024;
    const res = await upload({ size, name: 'большая деталь' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('большая деталь');
    // Ровно столько, сколько отправили: обрезка означала бы битую модель
    expect(body.fileSize).toBe(size);
  });

  it('имя после файла тоже доезжает', async () => {
    const res = await upload({ size: 300 * 1024, name: 'позже', nameFirst: false });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('позже');
  });

  it('чужой формат → 400', async () => {
    const res = await upload({ size: 200 * 1024, filename: 'чертёж.dwg' });
    expect(res.statusCode).toBe(400);
  });
});
