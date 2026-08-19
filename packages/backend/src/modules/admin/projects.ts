import type { FastifyInstance } from 'fastify';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AccountLevel, ProjectRole } from '@prisma/client';
import prisma from '../../db/prisma.js';
import { HttpError } from '../../utils/errors.js';
import { logAdminAction } from '../../utils/adminAudit.js';
import { projectFolderSize, uploadsDir } from '../../utils/uploadsSize.js';
import { buildPublicScene } from '../share/scenePayload.js';
import { requireFresh } from './guard.js';

/**
 * Проекты и уровни доступа в панели хозяина сервиса.
 *
 * Отдельным файлом от `routes.ts`, но регистрируется внутри него — оба хука
 * охраны там уже стоят и распространяются на вложенную регистрацию. Поэтому
 * здесь не нужно, и, что важнее, нельзя забыть, добавлять проверку к каждому
 * маршруту по отдельности.
 *
 * Войти в чужой проект как участник хозяин по-прежнему не может: в комнате
 * его бы увидели. Смотреть сцену — можно, отдельным снимком без сокета.
 */

const PAGE = 30;

const FILTERS = ['all', 'public', 'featured', 'deleted'] as const;
type Filter = (typeof FILTERS)[number];

const levelSchema = z.object({
  level: z.nativeEnum(AccountLevel),
});

function pageOf(query: unknown): number {
  const raw = (query as { page?: string })?.page;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

export default async function adminProjectRoutes(fastify: FastifyInstance) {
  // ── GET /api/admin/projects?query=&filter=&page= ──
  fastify.get('/projects', async (request, reply) => {
    const { query, filter } = request.query as { query?: string; filter?: string };
    const page = pageOf(request.query);
    const mode: Filter = (FILTERS as readonly string[]).includes(filter ?? '')
      ? (filter as Filter)
      : 'all';

    // Удалённые показываются только по прямой просьбе: корзина — отдельный
    // список, а не примесь к рабочему
    const byMode = {
      all: { deletedAt: null },
      public: { deletedAt: null, publicAt: { not: null } },
      featured: { deletedAt: null, featuredAt: { not: null } },
      deleted: { deletedAt: { not: null } },
    }[mode];

    /*
     * Поиск по названию — тем же способом, что и по людям: LOWER() для
     * латиницы плюс сравнение как набрано, потому что LOWER() в SQLite
     * кириллицу не трогает. Подробности — в комментарии к поиску людей.
     */
    let ids: string[] | null = null;
    if (query && query.trim()) {
      const raw = query.trim();
      const needle = `%${raw.toLowerCase()}%`;
      const asTyped = `%${raw}%`;
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects
        WHERE LOWER(name) LIKE ${needle}
           OR name LIKE ${asTyped}
        LIMIT 500
      `;
      ids = rows.map((r) => r.id);
      if (ids.length === 0) return reply.send({ data: [], page, total: 0 });
    }

    const where = { ...byMode, ...(ids ? { id: { in: ids } } : {}) };

    const [total, rows] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          publicAt: true,
          featuredAt: true,
          members: {
            select: {
              role: true,
              user: { select: { id: true, displayName: true, email: true } },
            },
          },
          _count: { select: { objects: true, models: true } },
        },
      }),
    ]);

    const sizes = await Promise.all(rows.map((p) => projectFolderSize(p.id)));

    return reply.send({
      page,
      total,
      data: rows.map((p, i) => {
        const master = p.members.find((m) => m.role === ProjectRole.MASTER);
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          deletedAt: p.deletedAt,
          isPublic: p.publicAt !== null,
          isFeatured: p.featuredAt !== null,
          owner: master ? { ...master.user } : null,
          members: p.members.length,
          objects: p._count.objects,
          models: p._count.models,
          bytes: sizes[i],
        };
      }),
    });
  });

  /*
   * Публичность и витрина — переключатели, поэтому четыре коротких маршрута
   * вместо одного с телом. Свежий код для них не требуется: включить и
   * выключить одинаково легко, отменяется одним нажатием.
   */

  fastify.post('/projects/:id/public', async (request, reply) =>
    reply.send(await setFlag(request, 'publicAt', true)),
  );

  fastify.delete('/projects/:id/public', async (request, reply) =>
    reply.send(await setFlag(request, 'publicAt', false)),
  );

  fastify.post('/projects/:id/feature', async (request, reply) =>
    reply.send(await setFlag(request, 'featuredAt', true)),
  );

  fastify.delete('/projects/:id/feature', async (request, reply) =>
    reply.send(await setFlag(request, 'featuredAt', false)),
  );

  /*
   * ── GET /api/admin/projects/:id/preview — тихий просмотр ──
   *
   * Тот же снимок, что у публичной ссылки, но без требования «проект открыт
   * всем». Хозяин смотрит сцену, участники в комнате его не видят: сокет
   * здесь не открывается. Закрытый и лежащий в корзине — тоже, иначе
   * «посмотреть, что удалили» пришлось бы сначала восстанавливать.
   */
  fastify.get('/projects/:id/preview', async (request, reply) => {
    const project = await load(request);

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.project-inspect',
      targetLabel: project.name,
      details: { projectId: project.id },
      ip: request.ip,
    });

    const scene = await buildPublicScene(project.id);
    if (!scene) throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
    return reply.send(scene);
  });

  // ── DELETE /api/admin/projects/:id — в корзину ──
  fastify.delete('/projects/:id', async (request, reply) => {
    const project = await load(request);
    if (project.deletedAt) throw new HttpError(409, 'CONFLICT', 'Уже в корзине');

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.project-delete',
      targetLabel: project.name,
      details: { projectId: project.id },
      ip: request.ip,
    });

    await prisma.project.update({
      where: { id: project.id },
      // Снимаем с витрины и с публикации заодно: проект в корзине не должен
      // остаться на главной, а восстановленный — вернуться туда сам
      data: { deletedAt: new Date(), featuredAt: null, publicAt: null },
    });

    return reply.send({ ok: true });
  });

  // ── POST /api/admin/projects/:id/restore ──
  fastify.post('/projects/:id/restore', async (request, reply) => {
    const project = await load(request);
    if (!project.deletedAt) throw new HttpError(409, 'CONFLICT', 'Проект не удалён');

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.project-restore',
      targetLabel: project.name,
      details: { projectId: project.id },
      ip: request.ip,
    });

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: null } });
    return reply.send({ ok: true });
  });

  /*
   * ── DELETE /api/admin/projects/:id/purge — стереть навсегда ──
   *
   * Единственное необратимое действие над проектами, поэтому требует свежего
   * кода и только из корзины: сначала удалить, потом стереть. Так между
   * промахом по кнопке и потерей чужой работы стоит два шага и телефон.
   *
   * Файлы удаляются после строки в базе. Наоборот было бы хуже: упади
   * удаление посреди дела — в базе остался бы проект, у которого пропали
   * модели, и открыть его человек уже не смог бы. Осиротевшая папка
   * безобиднее: её видно и можно убрать руками.
   */
  fastify.delete('/projects/:id/purge', async (request, reply) => {
    requireFresh(request);

    const project = await load(request);
    if (!project.deletedAt) {
      throw new HttpError(409, 'CONFLICT', 'Сначала отправьте проект в корзину');
    }

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.project-purge',
      targetLabel: project.name,
      details: { projectId: project.id },
      ip: request.ip,
    });

    await prisma.project.delete({ where: { id: project.id } });
    await rm(join(uploadsDir, project.id), { recursive: true, force: true });

    return reply.send({ ok: true });
  });

  /*
   * ── PATCH /api/admin/users/:id/level — уровень доступа ──
   *
   * Свежий код нужен, потому что понижение отбирает возможности: у мастера с
   * тремя проектами после понижения до зрителя проекты остаются, но завести
   * новый он уже не сможет.
   *
   * Уже выданные роли в чужих проектах не пересматриваются. Потолок работает
   * при выдаче роли, а отбирать задним числом — значит выкидывать человека из
   * работы, которую он ведёт, без предупреждения. Мастер проекта поменяет
   * роль сам, когда сочтёт нужным.
   */
  fastify.patch('/users/:id/level', async (request, reply) => {
    requireFresh(request);

    const { id } = request.params as { id: string };
    const parsed = levelSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Неизвестный уровень доступа');
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, accountLevel: true },
    });
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');
    if (target.accountLevel === parsed.data.level) {
      return reply.send({ ok: true });
    }

    await logAdminAction({
      actorId: request.user.userId,
      action: 'admin.level',
      targetUserId: target.id,
      targetLabel: `${target.displayName} <${target.email}>`,
      details: { from: target.accountLevel, to: parsed.data.level },
      ip: request.ip,
    });

    await prisma.user.update({
      where: { id: target.id },
      data: { accountLevel: parsed.data.level },
    });

    return reply.send({ ok: true });
  });
}

/** Проект по адресу — вместе с полями, по которым решают, что с ним можно */
async function load(request: { params: unknown }) {
  const { id } = request.params as { id: string };
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true, publicAt: true, featuredAt: true },
  });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Проект не найден');
  return project;
}

/**
 * Включить или выключить публичность либо витрину.
 *
 * Витрина требует публичности: проект на главной видит любой прохожий, и
 * ставить туда закрытый — то же самое, что открыть его, только молча.
 */
async function setFlag(
  request: Parameters<typeof load>[0] & { user: { userId: string }; ip: string },
  field: 'publicAt' | 'featuredAt',
  on: boolean,
) {
  const project = await load(request);
  if (project.deletedAt) throw new HttpError(409, 'CONFLICT', 'Проект в корзине');

  if (on && field === 'featuredAt' && !project.publicAt) {
    throw new HttpError(
      409,
      'CONFLICT',
      'Сначала сделайте проект публичным: на главной его увидит любой',
    );
  }

  await logAdminAction({
    actorId: request.user.userId,
    action: field === 'publicAt' ? 'admin.project-public' : 'admin.project-feature',
    targetLabel: project.name,
    details: { projectId: project.id, on },
    ip: request.ip,
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { [field]: on ? new Date() : null },
  });

  // Снятие публичности убирает и с витрины: иначе закрытый проект остался бы
  // висеть на самом заметном экране сервиса
  if (field === 'publicAt' && !on && project.featuredAt) {
    await prisma.project.update({ where: { id: project.id }, data: { featuredAt: null } });
  }

  return { ok: true };
}
