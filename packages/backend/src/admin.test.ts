import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Secret, TOTP } from 'otpauth';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Админка — единственное место, где ошибка в правах означает не «показали
 * лишнее», а чужие проекты в чужих руках. Поэтому здесь проверяется не
 * «работает ли», а «не пускает ли»: посторонний, украденный обычный токен,
 * повторно введённый код, просроченный пропуск.
 *
 * Каждый тест прогнан на коде до этой правки и там падает — иначе он ничего
 * не доказывает.
 */

const marker = `admintest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';

let app: FastifyInstance;
let adminToken = '';
let adminId = '';
let plainToken = '';
let victimToken = '';
let victimId = '';
let totpSecret = '';
let backupCodes: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const withPass = (jwt: string, pass: string) => ({
  authorization: `Bearer ${jwt}`,
  'x-admin-token': pass,
});

async function register(who: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: emailOf(who), password: PASSWORD, displayName: `Тест ${who}` },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().accessToken, id: res.json().user.id };
}

/**
 * Виртуальные часы на весь набор.
 *
 * Код действует одну минуту, и повторно тот же код не принимается — значит
 * подряд идущие входы в админку невозможны без движения времени. Часы
 * подменяются целиком, чтобы приложение и тест видели одно и то же: код,
 * выписанный на «сейчас» теста, обязан сойтись с «сейчас» сервера.
 */
const realNow = Date.now.bind(Date);
let shift = 0;
const tick = (ms = 60_000) => {
  shift += ms;
};

const codeFor = (secret: string) =>
  new TOTP({
    issuer: 'VOVPLAN',
    label: 'x',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: Date.now() });

/** Обменять свежий код на пропуск */
async function openSession(): Promise<string> {
  tick();
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/session',
    headers: auth(adminToken),
    payload: { code: codeFor(totpSecret) },
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

  plainToken = (await register('plain')).token;

  const victim = await register('victim');
  victimToken = victim.token;
  victimId = victim.id;

  // Признак хозяина ставится прямо в базе — ровно то, что делает
  // scripts/make-admin.mts: другого способа завести первого нет
  await prisma.user.update({ where: { id: adminId }, data: { isAdmin: true } });
});

afterAll(async () => {
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

describe('кого админка не пускает', () => {
  it('посторонний не находит её вовсе', async () => {
    for (const url of ['/api/admin/summary', '/api/admin/users', '/api/admin/audit', '/api/admin/projects/x/preview']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(plainToken) });
      // Именно 404: «недостаточно прав» подтвердило бы, что админка здесь есть
      expect(res.statusCode).toBe(404);
    }

    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/status',
      headers: auth(plainToken),
    });
    expect(status.statusCode).toBe(404);
  });

  it('гость без токена не проходит даже до проверки прав', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/summary' });
    expect(res.statusCode).toBe(401);
  });

  it('администратор с одним обычным токеном внутрь не попадает', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/summary',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('ADMIN_SESSION_REQUIRED');
  });

  it('пока второй фактор не подключён, пропуск не выдаётся', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('TOTP_REQUIRED');
  });
});

describe('подключение второго фактора', () => {
  it('секрет выдаётся вместе с картинкой для переноса в приложение', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/totp/setup',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.uri).toContain('otpauth://totp/');
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
    totpSecret = body.secret;

    // Выданный секрет ещё не работает: он подтверждается первым кодом
    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/status',
      headers: auth(adminToken),
    });
    expect(status.json()).toEqual({ totpEnabled: false, totpPending: true });
  });

  it('неверный код фактор не подключает', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/totp/enable',
      headers: auth(adminToken),
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CODE');
  });

  it('верный код подключает фактор и один раз показывает резервные коды', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/totp/enable',
      headers: auth(adminToken),
      payload: { code: codeFor(totpSecret) },
    });
    expect(res.statusCode).toBe(200);

    backupCodes = res.json().backupCodes;
    expect(backupCodes).toHaveLength(10);
    expect(backupCodes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);

    // В базе только хеши: показать список повторно неоткуда
    const stored = await prisma.totpBackupCode.findMany({ where: { userId: adminId } });
    expect(stored).toHaveLength(10);
    expect(stored.some((c) => backupCodes.includes(c.codeHash))).toBe(false);
  });

  it('переподключить работающий фактор через настройку нельзя', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/totp/setup',
      headers: auth(adminToken),
    });
    // Иначе захваченная сессия просто перевела бы коды на свой телефон
    expect(res.statusCode).toBe(409);
  });
});

describe('пропуск в админку', () => {
  it('код обменивается на пропуск, и с ним админка открывается', async () => {
    const pass = await openSession();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/summary',
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users.total).toBeGreaterThan(0);
    expect(typeof res.json().storageBytes).toBe('number');
    expect(res.json().levels).toEqual(
      expect.objectContaining({
        MASTER: expect.any(Number),
        MASTER_UNLIMITED: expect.any(Number),
        DESIGNER: expect.any(Number),
        SUPER_SPECTATOR: expect.any(Number),
        SPECTATOR: expect.any(Number),
      }),
    );
  });

  it('тот же код второй раз не принимается', async () => {
    tick();
    const code = codeFor(totpSecret);
    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code },
    });
    expect(first.statusCode).toBe(200);

    // Подсмотренный за плечом код живёт до полутора минут — этого хватает
    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code },
    });
    expect(second.statusCode).toBe(400);
  });

  it('резервный код срабатывает ровно один раз', async () => {
    const code = backupCodes[0];

    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code },
    });
    expect(second.statusCode).toBe(400);
  });

  it('резервный код принимается как записан на бумаге — как угодно', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/session',
      headers: auth(adminToken),
      payload: { code: ` ${backupCodes[1].toUpperCase().replace('-', '')} ` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('обычный токен, подсунутый вместо пропуска, не годится', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/summary',
      headers: withPass(adminToken, adminToken),
    });
    expect(res.statusCode).toBe(401);
  });

  it('пропуск не работает как обычный токен', async () => {
    const pass = await openSession();

    /*
     * Ключи подписи разные, поэтому пропуск не проверяется там, где ждут
     * обычный токен. Будь ключ общим, он прошёл бы и здесь, и в рукопожатии
     * сокета — там читают только идентификатор и поколение.
     */
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(pass) });
    expect(res.statusCode).toBe(401);
  });

  it('смена пароля гасит и пропуск', async () => {
    const pass = await openSession();

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: auth(adminToken),
      payload: { currentPassword: PASSWORD, newPassword: `${PASSWORD}-2` },
    });
    expect(changed.statusCode).toBe(200);
    adminToken = changed.json().accessToken;

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/summary',
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('блокировка', () => {
  it('забаненный теряет доступ немедленно и не может войти заново', async () => {
    const pass = await openSession();

    const banned = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${victimId}/ban`,
      headers: withPass(adminToken, pass),
      payload: { reason: 'проверка блокировки' },
    });
    expect(banned.statusCode).toBe(200);

    // Прежний токен умирает сразу, а не через неделю
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(victimToken) });
    expect(me.statusCode).toBe(403);
    expect(me.json().error).toBe('ACCOUNT_BANNED');
    expect(me.json().message).toContain('проверка блокировки');

    // И новый не выдаётся
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('victim'), password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('ACCOUNT_BANNED');
  });

  it('причина блокировки обязательна', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${victimId}/ban`,
      headers: withPass(adminToken, pass),
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('снятие блокировки возвращает вход', async () => {
    const pass = await openSession();

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${victimId}/unban`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('victim'), password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('администратора заблокировать нельзя — иначе сервис захватывается в одиночку', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId}/ban`,
      headers: withPass(adminToken, pass),
      payload: { reason: 'попытка запереть себя' },
    });
    expect(res.statusCode).toBe(403);

    const me = await prisma.user.findUnique({ where: { id: adminId }, select: { bannedAt: true } });
    expect(me?.bannedAt).toBeNull();
  });
});

describe('права администратора', () => {
  it('снять права с самого себя нельзя', async () => {
    const pass = await openSession();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${adminId}/admin`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(403);

    const me = await prisma.user.findUnique({ where: { id: adminId }, select: { isAdmin: true } });
    expect(me?.isAdmin).toBe(true);
  });

  it('снятие прав уносит и второй фактор', async () => {
    const pass = await openSession();
    const second = await register('second-admin');

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/admin/users/${second.id}/admin`,
          headers: withPass(adminToken, pass),
        })
      ).statusCode,
    ).toBe(200);

    await prisma.user.update({
      where: { id: second.id },
      data: { totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: new Date() },
    });
    await prisma.totpBackupCode.create({
      data: { userId: second.id, codeHash: `stale-${marker}` },
    });

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/users/${second.id}/admin`,
          headers: withPass(adminToken, pass),
        })
      ).statusCode,
    ).toBe(200);

    const after = await prisma.user.findUnique({
      where: { id: second.id },
      select: { isAdmin: true, totpSecret: true, totpEnabled: true },
    });
    expect(after).toEqual({ isAdmin: false, totpSecret: null, totpEnabled: null });
    expect(await prisma.totpBackupCode.count({ where: { userId: second.id } })).toBe(0);
  });
});

describe('список людей', () => {
  it('человек находится по имени, набранному кириллицей', async () => {
    const pass = await openSession();

    /*
     * Сервис русскоязычный, и почти у всех имя написано кириллицей. Встроенный
     * LOWER() у SQLite умеет только латиницу, поэтому запрос с приведением
     * регистра по обе стороны не находил такого человека вовсе — ни в нижнем
     * регистре, ни набранным точь-в-точь.
     */
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users?query=${encodeURIComponent('Тест victim')}`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((u: { id: string }) => u.id)).toContain(victimId);
  });

  it('поиск по почте не зависит от регистра', async () => {
    const pass = await openSession();

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users?query=${encodeURIComponent(emailOf('victim').toUpperCase())}`,
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((u: { id: string }) => u.id)).toContain(victimId);
  });
});

describe('свежесть пропуска', () => {
  it('через шесть минут читать можно, а блокировать — нет', async () => {
    const pass = await openSession();
    tick(6 * 60_000);

    // Читать можно: пропуск живёт полчаса
    const read = await app.inject({
      method: 'GET',
      url: '/api/admin/summary',
      headers: withPass(adminToken, pass),
    });
    expect(read.statusCode).toBe(200);

    // А блокировать — нет: оставленная открытой вкладка не должна этого мочь
    const ban = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${victimId}/ban`,
      headers: withPass(adminToken, pass),
      payload: { reason: 'через шесть минут' },
    });
    expect(ban.statusCode).toBe(403);
    expect(ban.json().error).toBe('STEP_UP_REQUIRED');

    const victim = await prisma.user.findUnique({
      where: { id: victimId },
      select: { bannedAt: true },
    });
    expect(victim?.bannedAt).toBeNull();
  });
});

describe('журнал', () => {
  it('действия видны в журнале и стереть их нечем', async () => {
    const pass = await openSession();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: withPass(adminToken, pass),
    });
    expect(res.statusCode).toBe(200);

    const actions = res.json().data.map((r: { action: string }) => r.action);
    expect(actions).toContain('admin.ban');
    expect(actions).toContain('admin.unban');
    expect(actions).toContain('admin.grant');

    const banRecord = res
      .json()
      .data.find((r: { action: string }) => r.action === 'admin.ban');
    // Имя цели записано строкой: пользователя могут удалить, запись обязана
    // остаться читаемой
    expect(banRecord.targetLabel).toContain(emailOf('victim'));
    expect(banRecord.details.reason).toBe('проверка блокировки');
    expect(banRecord.actorEmail).toBe(emailOf('admin'));

    // Маршрутов правки и удаления у журнала нет и не должно появиться
    for (const method of ['DELETE', 'PATCH'] as const) {
      const attempt = await app.inject({
        method,
        url: `/api/admin/audit/${banRecord.id}`,
        headers: withPass(adminToken, pass),
      });
      expect(attempt.statusCode).toBe(404);
    }
  });
});

describe('воронка', () => {
  it('обычный пользователь сводку не читает', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/funnel',
      headers: auth(plainToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('хозяин читает без второго фактора — это кабинет, не админка', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/funnel',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.length).toBeGreaterThan(0);
  });
});
