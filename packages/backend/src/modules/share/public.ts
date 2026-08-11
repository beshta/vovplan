import type { FastifyInstance } from 'fastify';
import prisma from '../../db/prisma.js';
import { signUploadUrl, signTerrainMeta } from '../../utils/signedUrl.js';

/**
 * Публичный доступ по share-токену — БЕЗ аутентификации.
 * Роль External Spectator: только внешний вид сцены.
 * Не отдаёт: инженерные сети, комментарии/аннотации, скрытые объекты,
 * данные участников.
 * Регистрируется под /api/shared.
 */
export default async function publicShareRoutes(fastify: FastifyInstance) {
  // ── GET /api/shared/:token — вся сцена одним запросом ──
  fastify.get('/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ссылка недействительна', statusCode: 404 });
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      return reply.code(410).send({ error: 'GONE', message: 'Срок действия ссылки истёк', statusCode: 410 });
    }

    const [project, objects, models, presets] = await Promise.all([
      prisma.project.findUnique({
        where: { id: link.projectId },
        select: { name: true, description: true, terrainUrl: true, terrainMeta: true },
      }),
      prisma.sceneObject.findMany({
        where: { projectId: link.projectId, visible: true },
        // Автор не выбирается намеренно: см. отказ от authorName ниже
        orderBy: { createdAt: 'asc' },
      }),
      prisma.model3D.findMany({
        where: { projectId: link.projectId },
        select: { id: true, glbUrl: true, lod1Url: true, lod2Url: true },
      }),
      prisma.cameraPreset.findMany({
        where: { projectId: link.projectId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    if (!project) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    return reply.send({
      project: {
        name: project.name,
        description: project.description ?? '',
        terrainUrl: signUploadUrl(project.terrainUrl),
        terrainMeta: signTerrainMeta(project.terrainMeta),
      },
      /*
       * Имя автора здесь больше не отдаётся.
       *
       * Модуль обещает не выдавать данные участников, но выдавал: у каждого
       * объекта ехало имя того, кто его поставил. Ссылку отправляют заказчику
       * или подрядчику, и состав команды — не то, что он должен узнать заодно
       * со сценой. Внешнему наблюдателю имена всё равно негде показать: панели
       * свойств в публичном просмотре нет.
       */
      objects: objects.map((o) => ({
        id: o.id,
        modelId: o.modelId ?? '',
        name: o.name,
        position: o.position as [number, number, number],
        rotation: o.rotation as [number, number, number],
        scale: o.scale as [number, number, number],
        description: o.description ?? '',
      })),
      models: models.map((m) => ({
        id: m.id,
        glbUrl: signUploadUrl(m.glbUrl),
        lod1Url: signUploadUrl(m.lod1Url),
        lod2Url: signUploadUrl(m.lod2Url),
      })),
      presets: presets.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position as [number, number, number],
        target: p.target as [number, number, number],
      })),
      startPresetId: link.presetId ?? null,
    });
  });
}
