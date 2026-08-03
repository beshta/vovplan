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

const createSchema = z.object({
  role: z.enum(['DESIGNER', 'SUPER_SPECTATOR', 'SPECTATOR', 'EXTERNAL_SPECTATOR']),
  expiresDays: z.number().int().min(1).max(365).optional(),
});

function dto(inv: any) {
  return {
    id: inv.id,
    token: inv.token,
    role: inv.role,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
  };
}

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

    const invite = await prisma.invite.create({
      data: {
        projectId,
        token: randomBytes(18).toString('base64url'),
        role: parsed.data.role as ProjectRole,
        expiresAt: parsed.data.expiresDays
          ? new Date(Date.now() + parsed.data.expiresDays * 86400_000)
          : null,
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

    // Уже участник? — просто отдаём projectId (идемпотентно)
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: invite.projectId, userId } },
    });
    if (!existing) {
      await prisma.projectMember.create({
        data: { projectId: invite.projectId, userId, role: invite.role },
      });
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      logActivity(fastify, { projectId: invite.projectId, actorId: userId, action: 'member.join', targetName: me?.displayName ?? null });
    }

    return reply.send({ projectId: invite.projectId, role: existing?.role ?? invite.role, already: !!existing });
  });
}
