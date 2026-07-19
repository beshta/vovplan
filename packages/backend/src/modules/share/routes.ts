import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission, requireMaster } from '../../utils/permissions.js';

const vec3 = z.array(z.number()).length(3);

const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  position: vec3,
  target: vec3,
});

const createShareSchema = z.object({
  name: z.string().min(1).max(100),
  presetId: z.string().optional(),
  expiresDays: z.number().int().min(1).max(365).optional(), // не задано = бессрочная
});

/**
 * Авторизованные роуты Фазы 7: пресеты камеры + управление share-ссылками.
 * Регистрируются под /api/projects.
 */
export default async function shareRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ═══ Camera Presets ═══

  // ── GET /api/projects/:projectId/presets — любой участник ──
  fastify.get('/:projectId/presets', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const role = await getUserRole(request.user.userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const presets = await prisma.cameraPreset.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return reply.send({ data: presets.map(presetDTO) });
  });

  // ── POST /api/projects/:projectId/presets — DESIGNER+ ──
  fastify.post('/:projectId/presets', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = createPresetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const preset = await prisma.cameraPreset.create({
      data: {
        projectId,
        name: parsed.data.name,
        position: parsed.data.position,
        target: parsed.data.target,
      },
    });

    return reply.code(201).send(presetDTO(preset));
  });

  // ── DELETE /api/projects/:projectId/presets/:id — DESIGNER+ ──
  fastify.delete('/:projectId/presets/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const existing = await prisma.cameraPreset.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пресет не найден', statusCode: 404 });
    }

    await prisma.cameraPreset.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ═══ Share Links (только MASTER) ═══

  // ── GET /api/projects/:projectId/shares ──
  fastify.get('/:projectId/shares', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    try {
      await requireMaster(request, projectId);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const links = await prisma.shareLink.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: links.map(shareDTO) });
  });

  // ── POST /api/projects/:projectId/shares ──
  fastify.post('/:projectId/shares', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    try {
      await requireMaster(request, projectId);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = createShareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    // Пресет (если указан) должен принадлежать этому проекту
    if (parsed.data.presetId) {
      const preset = await prisma.cameraPreset.findUnique({ where: { id: parsed.data.presetId } });
      if (!preset || preset.projectId !== projectId) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Пресет не найден в проекте', statusCode: 400 });
      }
    }

    const link = await prisma.shareLink.create({
      data: {
        projectId,
        token: randomBytes(24).toString('base64url'),
        name: parsed.data.name,
        presetId: parsed.data.presetId ?? null,
        expiresAt: parsed.data.expiresDays
          ? new Date(Date.now() + parsed.data.expiresDays * 24 * 60 * 60 * 1000)
          : null,
        createdById: request.user.userId,
      },
    });

    return reply.code(201).send(shareDTO(link));
  });

  // ── DELETE /api/projects/:projectId/shares/:id — отзыв ссылки ──
  fastify.delete('/:projectId/shares/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requireMaster(request, projectId);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const existing = await prisma.shareLink.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ссылка не найдена', statusCode: 404 });
    }

    await prisma.shareLink.delete({ where: { id } });
    return reply.code(204).send();
  });
}

function presetDTO(p: any) {
  return {
    id: p.id,
    name: p.name,
    position: p.position as [number, number, number],
    target: p.target as [number, number, number],
    sortOrder: p.sortOrder,
    createdAt: p.createdAt.toISOString(),
  };
}

function shareDTO(l: any) {
  return {
    id: l.id,
    token: l.token,
    name: l.name,
    presetId: l.presetId ?? null,
    expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}
