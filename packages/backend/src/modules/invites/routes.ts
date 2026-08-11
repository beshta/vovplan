import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ProjectRole } from '@prisma/client';
import prisma from '../../db/prisma.js';
import { requireMaster } from '../../utils/permissions.js';
import { logActivity } from '../../utils/activity.js';

/**
 * Приглашения по ссылке.
 *
 * Мастер (auth):
 *   POST   /api/projects/:projectId/invites        — создать ссылку (role, expiresDays?)
 *   GET    /api/projects/:projectId/invites        — список ссылок
 *   DELETE /api/projects/:projectId/invites/:id    — отозвать
 *
 * Публично / по auth:
 *   GET  /api/invites/:token         — инфо о приглашении (без auth — для страницы)
 *   POST /api/invites/:token/accept  — принять (auth): текущий пользователь входит в проект
 */

/**
 * Срок по умолчанию, если его не задали.
 *
 * Раньше по умолчанию ссылка была бессрочной: одна утёкшая переписка — и
 * посторонний заходит в проект хоть через год. Две недели покрывают обычный
 * сценарий «отправил коллеге, он зашёл», а кому нужно дольше — задаёт явно.
 */
const DEFAULT_EXPIRES_DAYS = 14;

const createSchema = z.object({
  role: z.enum(['DESIGNER', 'SUPER_SPECTATOR', 'SPECTATOR', 'EXTERNAL_SPECTATOR']),
  expiresDays: z.number().int().min(1).max(365).optional(),
  /** Сколько человек может войти по ссылке. Не задано — без ограничения */
  maxUses: z.number().int().min(1).max(1000).optional(),
});

function dto(inv: any) {
  return {
    id: inv.id,
    token: inv.token,
    role: inv.role,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    maxUses: inv.maxUses ?? null,
    usedCount: inv.usedCount ?? 0,
    createdAt: inv.createdAt.toISOString(),
  };
}

/** Исчерпана ли ссылка по числу входов */
const isExhausted = (inv: { maxUses: number | null; usedCount: number }) =>
  inv.maxUses !== null && inv.usedCount >= inv.maxUses;

/** Авторизованные роуты под /api/projects */
export async function inviteRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/:projectId/invites', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await requireMaster(request, projectId);

    const invites = await prisma.invite.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return reply.send({ data: invites.map(dto) });
  });

  fastify.post('/:projectId/invites', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await requireMaster(request, projectId);

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, statusCode: 400 });
    }

    const days = parsed.data.expiresDays ?? DEFAULT_EXPIRES_DAYS;
    const invite = await prisma.invite.create({
      data: {
        projectId,
        token: randomBytes(18).toString('base64url'),
        role: parsed.data.role as ProjectRole,
        // Срок теперь есть всегда: бессрочная ссылка по умолчанию — это
        // открытая дверь, о которой через месяц никто не помнит
        expiresAt: new Date(Date.now() + days * 86400_000),
        maxUses: parsed.data.maxUses ?? null,
        createdById: request.user.userId,
      },
    });
    return reply.code(201).send(dto(invite));
  });

  fastify.delete('/:projectId/invites/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    await requireMaster(request, projectId);

    const existing = await prisma.invite.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Приглашение не найдено', statusCode: 404 });
    }
    await prisma.invite.delete({ where: { id } });
    return reply.code(204).send();
  });
}

/** Публичные роуты под /api/invites */
export async function publicInviteRoutes(fastify: FastifyInstance) {
  // Инфо о приглашении — без авторизации (страница видна до входа)
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { project: { select: { name: true } } },
    });
    if (!invite) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Приглашение недействительно', statusCode: 404 });
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'GONE', message: 'Срок действия приглашения истёк', statusCode: 410 });
    }
    if (isExhausted(invite)) {
      return reply.code(410).send({ error: 'GONE', message: 'По этой ссылке уже вошли', statusCode: 410 });
    }
    return reply.send({ projectName: invite.project.name, role: invite.role });
  });

  // Принять приглашение — требует авторизации (пользователь уже вошёл/зарегистрировался)
  fastify.post('/:token/accept', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const userId = request.user.userId;

    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Приглашение недействительно', statusCode: 404 });
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'GONE', message: 'Срок действия приглашения истёк', statusCode: 410 });
    }

    // Уже участник? — просто отдаём projectId (идемпотентно).
    // Проверка идёт до списания входа: повторный переход по своей же ссылке
    // не должен съедать её у следующего.
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.projectId, userId } },
    });
    if (!existing) {
      /*
       * Вход списывается условным обновлением, а не «прочитал, сравнил,
       * записал». Двое, перешедшие по одноразовой ссылке одновременно, оба
       * прошли бы проверку и оба вошли: между чтением и записью успевает
       * вклиниться чужая запись. Здесь же условие проверяет сама база, и
       * второму обновить нечего.
       */
      const claimed = await prisma.invite.updateMany({
        where: {
          id: invite.id,
          ...(invite.maxUses !== null ? { usedCount: { lt: invite.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        return reply.code(410).send({ error: 'GONE', message: 'По этой ссылке уже вошли', statusCode: 410 });
      }

      await prisma.projectMember.create({
        data: { projectId: invite.projectId, userId, role: invite.role },
      });
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      logActivity(fastify, { projectId: invite.projectId, actorId: userId, action: 'member.join', targetName: me?.displayName ?? null });
    }

    return reply.send({ projectId: invite.projectId, role: existing?.role ?? invite.role, already: !!existing });
  });
}
