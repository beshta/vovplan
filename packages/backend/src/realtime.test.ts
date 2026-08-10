import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import prisma from './db/prisma.js';

/**
 * Сокеты — единственное место, где данные проекта уходят клиенту в обход
 * HTTP-маршрутов, и право там приходится проверять отдельно. Когда-то
 * проверки не было вовсе: зная чужой projectId, можно было войти в чужую
 * комнату и читать всё, что там происходит.
 *
 * Поэтому здесь поднимается настоящий сервер на настоящем порту и работают
 * настоящие клиенты: fastify.inject() вебсокеты не умеет, а значит и не
 * поймал бы эту дыру.
 */

const marker = `sockettest-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;
const PASSWORD = 'vitest-fixture-pw-1';

let app: FastifyInstance;
let url = '';
let ownerToken = '';
let outsiderToken = '';
let projectId = '';

/** Ждём событие; если не пришло — тест падает с внятным текстом */
function once<T>(socket: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`событие «${event}» не пришло за ${ms} мс`)), ms);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Ждём, что событие НЕ придёт. Именно это и проверяет утечку. */
function never(socket: Socket, event: string, ms = 1200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      reject(new Error(`пришло событие «${event}», которого быть не должно: ${JSON.stringify(data)}`));
    });
  });
}

function client(token: string): Promise<Socket> {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (e) => reject(e));
  });
}

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

beforeAll(async () => {
  rateLimitClearAll();
  app = await buildServer({ logger: false });
  // Порт 0 — операционная система выдаёт свободный: тесты не должны драться
  // за постоянный номер с запущенным рядом сервером разработки
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  ownerToken = await register('owner');
  outsiderToken = await register('outsider');

  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: auth(ownerToken),
    payload: {
      name: `Сокеты ${marker}`,
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
    await prisma.sceneObject.deleteMany({ where: { projectId: id } });
    await prisma.activityEvent.deleteMany({ where: { projectId: id } });
    await prisma.projectMember.deleteMany({ where: { projectId: id } });
    await prisma.project.deleteMany({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('сокеты: доступ к комнате проекта', () => {
  it('участник входит и получает список присутствующих', async () => {
    const socket = await client(ownerToken);
    try {
      const presence = once<Array<{ userId: string; name: string }>>(socket, 'presence');
      socket.emit('join', { projectId, name: 'Неважно' });
      const peers = await presence;
      expect(peers).toHaveLength(1);
      expect(peers[0].name).toBe('Test owner');
    } finally {
      socket.disconnect();
    }
  });

  it('имя в присутствии берётся из профиля, а не из присланного', async () => {
    const socket = await client(ownerToken);
    try {
      const presence = once<Array<{ name: string }>>(socket, 'presence');
      // Попытка представиться чужим именем
      socket.emit('join', { projectId, name: 'Директор Иванов' });
      const peers = await presence;
      expect(peers[0].name).toBe('Test owner');
    } finally {
      socket.disconnect();
    }
  });

  it('посторонний получает отказ на вход в чужой проект', async () => {
    const socket = await client(outsiderToken);
    try {
      const denied = once<{ projectId: string }>(socket, 'join:denied');
      socket.emit('join', { projectId });
      expect((await denied).projectId).toBe(projectId);
    } finally {
      socket.disconnect();
    }
  });

  it('посторонний не получает изменений в чужом проекте', async () => {
    const member = await client(ownerToken);
    const outsider = await client(outsiderToken);
    try {
      const joined = once(member, 'presence');
      member.emit('join', { projectId });
      await joined;

      outsider.emit('join', { projectId });
      await once(outsider, 'join:denied');

      // Настоящее изменение в проекте: участник обязан его увидеть,
      // посторонний — ни в коем случае
      const memberSees = once(member, 'object:changed');
      const outsiderMustNotSee = never(outsider, 'object:changed');

      const created = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/objects`,
        headers: auth(ownerToken),
        payload: { name: 'Секретный объект', position: [1, 2, 3] },
      });
      expect(created.statusCode).toBe(201);

      await memberSees;
      await outsiderMustNotSee;
    } finally {
      member.disconnect();
      outsider.disconnect();
    }
  });

  it('посторонний не может подсунуть движение объекта в чужую комнату', async () => {
    const member = await client(ownerToken);
    const outsider = await client(outsiderToken);
    try {
      const joined = once(member, 'presence');
      member.emit('join', { projectId });
      await joined;

      const mustStaySilent = never(member, 'object:transform');
      // Комната берётся из того, куда сокет вошёл, поэтому projectId в самом
      // событии ничего не решает — раньше решал
      outsider.emit('object:transform', {
        projectId,
        objectId: 'подделка',
        position: [999, 999, 999],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
      await mustStaySilent;
    } finally {
      member.disconnect();
      outsider.disconnect();
    }
  });
});
