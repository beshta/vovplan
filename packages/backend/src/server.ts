import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config/index.js';
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import authRoutes from './modules/auth/routes.js';
import projectRoutes from './modules/projects/routes.js';
import sceneRoutes from './modules/scene/routes.js';
import modelRoutes from './modules/models/routes.js';
import utilityRoutes from './modules/utilities/routes.js';
import terrainRoutes from './modules/terrain/routes.js';
import commentRoutes from './modules/comments/routes.js';

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: config.isDev,
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

  // ── Static file serving (uploaded models) ──
  const uploadsDir = join(process.cwd(), 'uploads');
  await fastify.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // ── Health check ───────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── API Routes ─────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(projectRoutes, { prefix: '/api/projects' });
  await fastify.register(sceneRoutes, { prefix: '/api/projects' });
  await fastify.register(modelRoutes, { prefix: '/api/projects' });
  await fastify.register(utilityRoutes, { prefix: '/api/projects' });
  await fastify.register(terrainRoutes, { prefix: '/api/projects' });
  await fastify.register(commentRoutes, { prefix: '/api/projects' });

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

async function start() {
  try {
    const server = await buildServer();

    await server.listen({ port: config.port, host: config.host });
    server.log.info(`🚀 VOVPLAN backend running at http://${config.host}:${config.port}`);
    server.log.info(`   Environment: ${config.nodeEnv}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
