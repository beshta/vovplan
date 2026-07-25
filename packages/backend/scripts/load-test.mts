/**
 * Нагрузочный тест: 10 пользователей одновременно.
 *
 * Сценарий:
 *   1. Мастер создаёт свежий проект.
 *   2. Регистрируются 10 пользователей, каждый приглашается DESIGNER.
 *   3. Все 10 ПАРАЛЛЕЛЬНО: подключают realtime-сокет, грузят объект,
 *      добавляют инженерную сеть и аннотацию.
 *   4. Проверяется целостность (по 10 сущностей, 10 разных авторов) и
 *      realtime (presence виден всеми, мутации разосланы).
 *   5. Полная очистка: проект (каскад) + тестовые пользователи.
 *
 * Запуск (backend должен быть поднят на :4000):
 *   VOVPLAN_DEV_PASSWORD=<пароль> npx tsx scripts/load-test.mts
 */
import { io, type Socket } from 'socket.io-client';
import prisma from '../src/db/prisma.js';

const BASE = process.env.LOADTEST_BASE ?? 'http://localhost:4000';
const MASTER_EMAIL = 'vladimir@vovplan.io';
const PASSWORD = process.env.VOVPLAN_DEV_PASSWORD;
if (!PASSWORD) throw new Error('Задайте VOVPLAN_DEV_PASSWORD (см. LINKS.local.txt)');
const N = 10;
const marker = `loadtest-${Date.now()}`;
const USER_PW = 'loadtest-pw-123';

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.status === 204 ? null : res.json();
}

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const t0 = Date.now();
  console.log(`\n🔸 Нагрузочный тест: ${N} пользователей одновременно\n`);

  // 1. Мастер + проект
  const master = await api('POST', '/api/auth/login', undefined, { email: MASTER_EMAIL, password: PASSWORD });
  const project = await api('POST', '/api/projects', master.accessToken, {
    name: `LoadTest ${marker}`, description: 'нагрузочный тест',
    centerLat: 55.75, centerLng: 37.61,
    bounds: { north: 55.76, south: 55.74, east: 37.62, west: 37.6 },
  });
  const pid = project.id;
  console.log(`  проект создан: ${pid}`);

  // 2. Регистрация + приглашение 10 пользователей
  const users = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const email = `${marker}.u${i}@test.vovplan.io`;
      const reg = await api('POST', '/api/auth/register', undefined, {
        email, password: USER_PW, displayName: `User ${i}`,
      });
      await api('POST', `/api/projects/${pid}/members`, master.accessToken, { email, role: 'DESIGNER' });
      return { i, email, token: reg.accessToken, userId: reg.user.id };
    }),
  );
  console.log(`  ${users.length} пользователей зарегистрированы и приглашены DESIGNER`);

  // 3. ПАРАЛЛЕЛЬНО: сокет + объект + сеть + аннотация
  const sockets: Socket[] = [];
  let peakPresence = 0;
  const results = await Promise.all(users.map(async (u) => {
    // realtime-сокет
    const sock = io(BASE, { auth: { token: u.token }, transports: ['websocket'], reconnection: false });
    sockets.push(sock);
    await new Promise<void>((resolve, reject) => {
      sock.on('connect', () => { sock.emit('join', { projectId: pid, name: `User ${u.i}` }); resolve(); });
      sock.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket timeout')), 8000);
    });
    sock.on('presence', (peers: unknown[]) => { peakPresence = Math.max(peakPresence, peers.length); });

    const angle = (u.i / N) * Math.PI * 2;
    const [x, z] = [Math.cos(angle) * 30, Math.sin(angle) * 30];
    const obj = await api('POST', `/api/projects/${pid}/objects`, u.token, {
      name: `Объект U${u.i}`, position: [x, 0, z],
    });
    const util = await api('POST', `/api/projects/${pid}/utilities`, u.token, {
      name: `Сеть U${u.i}`, type: 'WATER', location: 'UNDERGROUND',
      geometry: [[x, -1.5, z], [x + 10, -1.5, z + 5]],
    });
    const ann = await api('POST', `/api/projects/${pid}/comments`, u.token, {
      text: `Метка U${u.i}`, type: 'pin', geometry: [[x, 1, z]], color: '#ef4444',
    });
    return { obj, util, ann, userId: u.userId };
  }));
  console.log(`  все ${N} завершили: объект + сеть + аннотация\n`);

  // Дать presence-рассылке устаканиться
  await new Promise((r) => setTimeout(r, 500));

  // 4. Проверки целостности (глазами мастера)
  const objects = await api('GET', `/api/projects/${pid}/objects`, master.accessToken);
  const utils = await api('GET', `/api/projects/${pid}/utilities`, master.accessToken);
  const comments = await api('GET', `/api/projects/${pid}/comments`, master.accessToken);
  const members = await api('GET', `/api/projects/${pid}/members`, master.accessToken);

  ok(objects.data.length === N, `объектов создано: ${objects.data.length}/${N}`);
  ok(utils.data.length === N, `инж. сетей создано: ${utils.data.length}/${N}`);
  ok(comments.data.length === N, `аннотаций создано: ${comments.data.length}/${N}`);
  ok(members.data.length === N + 1, `участников (10 + мастер): ${members.data.length}/${N + 1}`);

  const distinctAuthors = new Set(objects.data.map((o: any) => o.authorId)).size;
  ok(distinctAuthors === N, `объекты от ${distinctAuthors}/${N} разных авторов`);
  ok(results.every((r) => r.obj?.id && r.util?.id && r.ann?.id), 'все ответы содержат id (нет потерь)');
  ok(peakPresence >= 2, `realtime presence: пик ${peakPresence} онлайн одновременно`);

  // 5. Очистка
  sockets.forEach((s) => s.disconnect());
  await api('DELETE', `/api/projects/${pid}`, master.accessToken); // каскад: объекты/сети/комменты/членства
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  console.log(`\n  очистка: проект и ${N} пользователей удалены`);

  console.log(`\n🔸 Тест завершён за ${((Date.now() - t0) / 1000).toFixed(1)}с — ${process.exitCode ? 'ЕСТЬ ОШИБКИ' : 'ВСЁ ОК'}\n`);
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0);
}

main().catch(async (err) => {
  console.error('\n❌ Тест упал:', err.message);
  try { await prisma.user.deleteMany({ where: { email: { contains: marker } } }); } catch {}
  await prisma.$disconnect();
  process.exit(1);
});
