import type { FastifyInstance } from 'fastify';
import prisma from '../../db/prisma.js';
import { buildPublicScene } from '../share/scenePayload.js';

/**
 * Открытые проекты и витрина на главной — БЕЗ аутентификации.
 *
 * Отличие от share-ссылки: там доступ даёт знание секретного токена, здесь —
 * решение хозяина сервиса открыть проект всем. Адрес короткий и угадываемый
 * (`/p/:id`), поэтому единственная защита — флаг `publicAt`: нет флага, нет
 * ответа, даже если идентификатор известен.
 *
 * Отдаётся ровно то же, что по share-ссылке: без сетей, комментариев,
 * скрытых объектов и имён участников.
 */
export default async function publicProjectRoutes(fastify: FastifyInstance) {
  // ── GET /api/public/projects/:id ──
  fastify.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const project = await prisma.project.findFirst({
      where: { id, publicAt: { not: null }, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const scene = await buildPublicScene(id, null);
    if (!scene) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }
    return reply.send(scene);
  });

  /*
   * ── GET /api/public/featured — что показать на главной ──
   *
   * Самый свежий из поставленных на витрину, а не единственный: так «поставить
   * другой» — одно действие, а не два, и промах между ними не оставляет
   * главную с пустым местом.
   *
   * Публичность обязательна отдельным условием. Иначе проект, снятый с
   * публикации, продолжал бы крутиться на главной, где его видит вообще
   * каждый, — самый заметный экран сервиса.
   */
  fastify.get('/featured', async (_request, reply) => {
    const featured = await prisma.project.findFirst({
      where: { featuredAt: { not: null }, publicAt: { not: null }, deletedAt: null },
      orderBy: { featuredAt: 'desc' },
      select: { id: true, name: true, description: true },
    });

    if (!featured) return reply.send({ project: null });

    const scene = await buildPublicScene(featured.id, null);
    if (!scene) return reply.send({ project: null });
    return reply.send({ projectId: featured.id, ...scene });
  });
}
