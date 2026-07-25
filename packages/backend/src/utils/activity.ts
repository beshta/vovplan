import type { FastifyInstance } from 'fastify';
import prisma from '../db/prisma.js';

/**
 * Записывает событие в ленту активности проекта и рассылает его онлайн-участникам.
 * Fire-and-forget: ошибка логирования никогда не должна ронять саму мутацию.
 */
export function logActivity(
  fastify: FastifyInstance,
  params: { projectId: string; actorId: string; action: string; targetName?: string | null },
): void {
  const { projectId, actorId, action, targetName } = params;
  prisma.activityEvent
    .create({
      data: { projectId, actorId, action, targetName: targetName ?? null },
      include: { actor: { select: { displayName: true } } },
    })
    .then((ev) => {
      fastify.io?.to(`project:${projectId}`).emit('activity:new', {
        id: ev.id,
        action: ev.action,
        targetName: ev.targetName,
        actorId: ev.actorId,
        actorName: ev.actor.displayName,
        createdAt: ev.createdAt.toISOString(),
      });
    })
    .catch((err) => {
      fastify.log.warn({ err }, 'logActivity failed');
    });
}
