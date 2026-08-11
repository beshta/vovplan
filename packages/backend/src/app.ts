import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config/index.js';
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import authRoutes from './modules/auth/routes.js';
import analyticsRoutes from './modules/analytics/routes.js';
import projectRoutes from './modules/projects/routes.js';
import sceneRoutes from './modules/scene/routes.js';
import modelRoutes from './modules/models/routes.js';
import utilityRoutes from './modules/utilities/routes.js';
import fenceRoutes from './modules/fences/routes.js';
import terrainRoutes from './modules/terrain/routes.js';
import commentRoutes from './modules/comments/routes.js';
import shareRoutes from './modules/share/routes.js';
import publicShareRoutes from './modules/share/public.js';
import activityRoutes from './modules/activity/routes.js';
import { inviteRoutes, publicInviteRoutes } from './modules/invites/routes.js';
import snapshotRoutes from './modules/snapshots/routes.js';
import { setupRealtime } from './realtime/index.js';
import { verifyUploadSignature } from './utils/signedUrl.js';

/**
 * Build the Fastify app without listening.
 * Used by server.ts (dev/prod entry) and by tests via fastify.inject().
 */
export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: opts.logger ?? config.isDev,
  });

  // ── Plugins ────────────────────────────────
  await fastify.register(corsPlugin);
  await fastify.register(authPlugin);

  // ── File upload (multipart) ────────────────
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB per file
    },
  });

  /*
   * ── Раздача загруженных файлов ──
   *
   * Раньше здесь не было никакой проверки: модели, текстуры рельефа и аватары
   * любого проекта скачивал кто угодно, зная ссылку, — а ссылки утекают через
   * публичные share-ссылки навсегда.
   *
   * Проверять токен нельзя: браузер не прикладывает `Authorization`, когда
   * грузит картинку в `<img>` или модель загрузчиком three.js. Поэтому право
   * доступа лежит в самой ссылке — подписью со сроком годности, которую
   * выдают маршруты API вместе с данными.
   *
   * Плагин раздачи заворачивается в отдельную область видимости, чтобы хук
   * висел только на нём и не трогал остальные маршруты.
   */
  const uploadsDir = join(process.cwd(), 'uploads');
  await fastify.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      const [path] = request.url.split('?');
      const { exp, sig } = request.query as { exp?: string; sig?: string };
      if (!verifyUploadSignature(decodeURIComponent(path), exp, sig)) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Ссылка недействительна или устарела',
          statusCode: 403,
        });
      }
    });

    await scope.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
      decorateReply: false,
    });
  });

  // ── Health check ───────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── API Routes ─────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });
  await fastify.register(projectRoutes, { prefix: '/api/projects' });
  await fastify.register(sceneRoutes, { prefix: '/api/projects' });
  await fastify.register(modelRoutes, { prefix: '/api/projects' });
  await fastify.register(utilityRoutes, { prefix: '/api/projects' });
  await fastify.register(fenceRoutes, { prefix: '/api/projects' });
  await fastify.register(terrainRoutes, { prefix: '/api/projects' });
  await fastify.register(commentRoutes, { prefix: '/api/projects' });
  await fastify.register(shareRoutes, { prefix: '/api/projects' });
  await fastify.register(activityRoutes, { prefix: '/api/projects' });
  await fastify.register(inviteRoutes, { prefix: '/api/projects' });
  await fastify.register(snapshotRoutes, { prefix: '/api/projects' });
  await fastify.register(publicShareRoutes, { prefix: '/api/shared' });
  await fastify.register(publicInviteRoutes, { prefix: '/api/invites' });

  // ── Real-time collaboration (Socket.io) ────
  setupRealtime(fastify);

  // ── Error handler ──────────────────────────
  fastify.setErrorHandler((error: any, request, reply) => {
    const statusCode: number = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Internal server error');
    }

    reply.code(statusCode).send({
      error: error.code ?? 'INTERNAL_ERROR',
      message: statusCode >= 500 && !config.isDev ? 'Внутренняя ошибка сервера' : error.message,
      statusCode,
    });
  });

  return fastify;
}
