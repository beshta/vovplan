import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountLevel } from '@prisma/client';
import prisma from '../../db/prisma.js';
import { HttpError } from '../../utils/errors.js';
import { logAdminAction, labelOf } from '../../utils/adminAudit.js';
import { totalUploadsSize } from '../../utils/uploadsSize.js';
import { adminGuard, requireFresh } from './guard.js';
import adminProjectRoutes from './projects.js';

/**
 * Панель хозяина сервиса.
 *
 * Чего здесь нет и не появится: входа под чужой учётной записью. Соблазн
 * «посмотреть глазами пользователя» велик, но это доступ к чужим проектам,
 * и никакая запись в журнале его не оправдывает — оправдываться пришлось бы
 * перед человеком, который на такое не соглашался.
 */

const PAGE = 30;

const banSchema = z.object({
  reason: z.string().trim().min(3, 'Причина обязательна').max(300),
});

/** Номер страницы из строки запроса: мусор считаем первой страницей */
function pageOf(query: unknown): number {
  const raw = (query as { page?: string })?.page;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function adminRoutes(fastify: FastifyInstance) {
  /*
   * Два хука по порядку: сначала обычная проверка токена, потом пропуск.
   * Оба — на всю область видимости, поэтому новый маршрут защищён с
   * рождения, а не с того момента, как о нём вспомнят.
   */
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', adminGuard);

  // Проекты и уровни — отдельным файлом, но в этой же области видимости:
  // хуки выше накрывают и их
  await fastify.register(adminProjectRoutes);

  // ── GET /api/admin/summary ────────────────
  fastify.get('/summary', async (_request, reply) => {
    const [users, week, month, banned, admins, projects, deleted, pub, imports, storageBytes, grouped] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
        prisma.user.count({ where: { createdAt: { gte: since(30) } } }),
        prisma.user.count({ where: { bannedAt: { not: null } } }),
        prisma.user.count({ where: { isAdmin: true } }),
        prisma.project.count({ where: { deletedAt: null } }),
        prisma.project.count({ where: { deletedAt: { not: null } } }),
        prisma.project.count({ where: { deletedAt: null, publicAt: { not: null } } }),
        prisma.activityEvent.count({ where: { action: 'terrain.import' } }),
        totalUploadsSize(),
        prisma.user.groupBy({ by: ['accountLevel'], _count: { id: true } }),
      ]);

    const levels = Object.fromEntries(Object.values(AccountLevel).map((level) => [level, 0])) as Record<
      AccountLevel,
      number
    >;
    for (const row of grouped) levels[row.accountLevel] = row._count.id;

    return reply.send({
      users: { total: users, week, month, banned, admins },
      // Число, а не объект, живущим проектам оставлено намеренно: сводку
      // читают глазами, и «проектов: 12» понятнее, чем разбор по состояниям
      projects,
      deletedProjects: deleted,
      publicProjects: pub,
      terrainImports: imports,
      storageBytes,
      levels,
    });
  });

  // ── GET /api/admin/users?query=&page= ─────
  fastify.get('/users', async (request, reply) => {
    const { query } = request.query as { query?: string };
    const page = pageOf(request.query);

    /*
     * Поиск без учёта регистра — сырым запросом через LOWER(), как в
     * `utils/email.ts`: `mode: 'insensitive'` у Prisma есть только для
     * PostgreSQL, а разработка идёт на SQLite.
     *
     * Третье условие — про кириллицу. Встроенный LOWER() у SQLite умеет
     * только латиницу: «Смоук» он оставляет как есть, а искомое мы опустили
     * в нижний регистр ещё в JS — и русское имя не находилось вообще никак,
     * даже набранное точь-в-точь. Сравнение с ненормализованной строкой это
     * чинит для главного случая: человек ищет так, как имя написано в
     * списке. На PostgreSQL, где LOWER() знает про Юникод, работают оба
     * условия, и разница между средами — только в том, что разработка
     * находит меньше, а не больше.
     */
    let ids: string[] | null = null;
    if (query && query.trim()) {
      const raw = query.trim();
      const needle = `%${raw.toLowerCase()}%`;
      const asTyped = `%${raw}%`;
      // Имя в кавычках: в базе колонка называется `displayName`, и без них
      // PostgreSQL опустит регистр сам и не найдёт её
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE LOWER(email) LIKE ${needle}
           OR LOWER("displayName") LIKE ${needle}
           OR "displayName" LIKE ${asTyped}
        LIMIT 500
      `;
      ids = rows.map((r) => r.id);
      if (ids.length === 0) return reply.send({ data: [], page, total: 0 });
    }

    const where = ids ? { id: { in: ids } } : {};

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
          emailVerified: true,
          isAdmin: true,
          accountLevel: true,
          bannedAt: true,
          banReason: true,
          // Своих проектов у пользователя нет — есть участие в чужих;
          // владелец отличается только ролью MASTER в этом же списке
          _count: { select: { memberships: true } },
        },
      }),
    ]);

    return reply.send({
      page,
      total,
      data: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        createdAt: u.createdAt,
        emailVerified: u.emailVerified !== null,
        isAdmin: u.isAdmin,
        accountLevel: u.accountLevel,
        bannedAt: u.bannedAt,
        banReason: u.banReason,
        projects: u._count.memberships,
      })),
    });
  });

  // ── POST /api/admin/users/:id/ban ─────────
  fastify.post('/users/:id/ban', async (request, reply) => {
    requireFresh(request);

    const { id } = request.params as { id: string };
    const parsed = banSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, isAdmin: true, bannedAt: true },
    });
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');

    /*
     * Себя и других администраторов заблокировать нельзя.
     *
     * Себя — потому что снять блокировку будет некому. Другого хозяина —
     * потому что это способ захватить сервис в одиночку: заблокировал
     * остальных и остался единственным. Сначала снять права, потом
     * блокировать; оба шага останутся в журнале.
     */
    if (target.isAdmin) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Администратора нельзя заблокировать. Сначала снимите права',
      );
    }
    if (target.bannedAt) {
      throw new HttpError(409, 'CONFLICT', 'Уже заблокирован');
    }

    // Журнал первым: если запись не легла, действия не было
    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.ban',
      targetUserId: target.id,
      targetLabel: labelOf(target),
      details: { reason: parsed.data.reason },
      ip: request.ip,
    });

    await prisma.user.update({
      where: { id: target.id },
      data: {
        bannedAt: new Date(),
        banReason: parsed.data.reason,
        // Поднятие поколения выгоняет отовсюду прямо сейчас, включая сокеты
        tokenVersion: { increment: 1 },
      },
    });

    return reply.send({ ok: true });
  });

  // ── POST /api/admin/users/:id/unban ───────
  fastify.post('/users/:id/unban', async (request, reply) => {
    requireFresh(request);

    const { id } = request.params as { id: string };
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, bannedAt: true },
    });
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');
    if (!target.bannedAt) throw new HttpError(409, 'CONFLICT', 'Не заблокирован');

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.unban',
      targetUserId: target.id,
      targetLabel: labelOf(target),
      ip: request.ip,
    });

    await prisma.user.update({
      where: { id: target.id },
      data: { bannedAt: null, banReason: null },
    });

    return reply.send({ ok: true });
  });

  // ── POST /api/admin/users/:id/admin — выдать права ──
  fastify.post('/users/:id/admin', async (request, reply) => {
    requireFresh(request);

    const { id } = request.params as { id: string };
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, isAdmin: true, bannedAt: true },
    });
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');
    if (target.isAdmin) throw new HttpError(409, 'CONFLICT', 'Уже администратор');
    if (target.bannedAt) {
      throw new HttpError(403, 'FORBIDDEN', 'Сначала снимите блокировку');
    }

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.grant',
      targetUserId: target.id,
      targetLabel: labelOf(target),
      ip: request.ip,
    });

    await prisma.user.update({ where: { id: target.id }, data: { isAdmin: true } });
    return reply.send({ ok: true });
  });

  // ── DELETE /api/admin/users/:id/admin — снять права ──
  fastify.delete('/users/:id/admin', async (request, reply) => {
    requireFresh(request);

    const { id } = request.params as { id: string };

    /*
     * Снять права с себя нельзя.
     *
     * Один промах — и хозяин снаружи собственного сервиса, а вернуть себя
     * может только другой администратор, которого может и не быть.
     * Восстановление тогда — только скриптом на сервере.
     */
    if (id === request.user.userId) {
      throw new HttpError(403, 'FORBIDDEN', 'Нельзя снять права с самого себя');
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, isAdmin: true },
    });
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');
    if (!target.isAdmin) throw new HttpError(409, 'CONFLICT', 'Не администратор');

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.revoke',
      targetUserId: target.id,
      targetLabel: labelOf(target),
      ip: request.ip,
    });

    /*
     * Вместе с правами снимаем второй фактор: чужой секрет в базе бывшему
     * администратору ни к чему, а при возврате прав фактор подключается
     * заново — и это к лучшему, старый мог остаться на потерянном телефоне.
     */
    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: { isAdmin: false, totpSecret: null, totpEnabled: null },
      }),
      prisma.totpBackupCode.deleteMany({ where: { userId: target.id } }),
    ]);

    return reply.send({ ok: true });
  });

  // ── GET /api/admin/audit?page= ────────────
  // Только чтение. Маршрутов правки и удаления у журнала нет и не должно
  // появиться: журнал, который можно подчистить, ничего не доказывает.
  fastify.get('/audit', async (request, reply) => {
    const page = pageOf(request.query);

    const [total, rows] = await Promise.all([
      prisma.adminAction.count(),
      prisma.adminAction.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { actor: { select: { displayName: true, email: true } } },
      }),
    ]);

    return reply.send({
      page,
      total,
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorName: r.actor.displayName,
        actorEmail: r.actor.email,
        targetLabel: r.targetLabel,
        details: r.details,
        ip: r.ip,
        createdAt: r.createdAt,
      })),
    });
  });
}
