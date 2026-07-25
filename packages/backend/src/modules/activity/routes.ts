import type { FastifyInstance } from 'fastify';
import prisma from '../../db/prisma.js';
import { getUserRole } from '../../utils/permissions.js';

/**
 * Лента активности проекта — GET /api/projects/:projectId/activity
 * Доступна любому участнику. Отдаёт последние события (кто/что/когда).
 */
export default async function activityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/:projectId/activity', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { limit } = request.query as { limit?: string };

    const role = await getUserRole(request.user.userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const events = await prisma.activityEvent.findMany({
      where: { projectId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return reply.send({
      data: events.map((e) => ({
        id: e.id,
        action: e.action,
        targetName: e.targetName,
        actorId: e.actorId,
        actorName: e.actor.displayName,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });
}
