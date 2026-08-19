import type { FastifyInstance } from 'fastify';
import prisma from '../../db/prisma.js';
import { buildPublicScene } from './scenePayload.js';

/**
 * Публичный доступ по share-токену — БЕЗ аутентификации.
 * Роль External Spectator: только внешний вид сцены.
 * Не отдаёт: инженерные сети, комментарии/аннотации, скрытые объекты,
 * данные участников — за это отвечает общий сборщик `buildPublicScene`.
 * Регистрируется под /api/shared.
 */
export default async function publicShareRoutes(fastify: FastifyInstance) {
  // ── GET /api/shared/:token — вся сцена одним запросом ──
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const link = await prisma.shareLink.findUnique({
      where: { token },
      include: { project: { select: { deletedAt: true } } },
    });
    if (!link) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ссылка недействительна', statusCode: 404 });
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'GONE', message: 'Срок действия ссылки истёк', statusCode: 410 });
    }
    // Проект в корзине не показывается и по ссылке: удалили — значит убрали
    // отовсюду, а не только из своего списка
    if (link.project.deletedAt) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ссылка недействительна', statusCode: 404 });
    }

    const scene = await buildPublicScene(link.projectId, link.presetId ?? null);
    if (!scene) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    return reply.send(scene);
  });
}
