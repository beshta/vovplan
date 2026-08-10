import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission } from '../../utils/permissions.js';
import { emitFenceChanged } from '../../realtime/index.js';
import { logActivity } from '../../utils/activity.js';

/** Ломаная по земле: [x, y, z] в локальных метрах сцены */
const geometrySchema = z.array(z.array(z.number()).length(3)).min(2);

const typeSchema = z.enum(['FAN_BARRIER', 'MESH_3D', 'CONCRETE']);

/*
 * Высоту ограничиваем сверху: за 6 м это уже не забор, а стена, и в сцене
 * такая полоса перекрывает всё остальное. Снизу — 0,5 м, ниже секция не
 * стоит ни у одного из трёх типов.
 */
const heightSchema = z.number().min(0.5).max(6);

const createFenceSchema = z.object({
  name: z.string().min(1).max(200),
  type: typeSchema,
  geometry: geometrySchema,
  height: heightSchema.optional(),
  closed: z.boolean().optional(),
});

const updateFenceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: typeSchema.optional(),
  geometry: geometrySchema.optional(),
  height: heightSchema.optional(),
  closed: z.boolean().optional(),
});

type FenceRow = {
  id: string;
  name: string;
  type: string;
  geometry: unknown;
  height: number | null;
  closed: boolean;
};

const toPayload = (f: FenceRow) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  geometry: f.geometry as [number, number, number][],
  height: f.height ?? null,
  closed: f.closed,
});

export default async function fenceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/projects/:projectId/fences ──
  fastify.get('/:projectId/fences', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const role = await getUserRole(request.user.userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const fences = await prisma.fence.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: fences.map(toPayload) });
  });

  // ── POST /api/projects/:projectId/fences ──
  fastify.post('/:projectId/fences', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    await requirePermission(request, projectId, 'model:upload');

    const parsed = createFenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const fence = await prisma.fence.create({
      data: {
        projectId,
        name: parsed.data.name,
        type: parsed.data.type,
        geometry: parsed.data.geometry,
        height: parsed.data.height ?? null,
        closed: parsed.data.closed ?? false,
      },
    });

    const payload = toPayload(fence);
    emitFenceChanged(fastify, projectId, payload);
    logActivity(fastify, { projectId, actorId: request.user.userId, action: 'fence.create', targetName: fence.name });
    return reply.code(201).send(payload);
  });

  // ── PATCH /api/projects/:projectId/fences/:id ──
  fastify.patch('/:projectId/fences/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    await requirePermission(request, projectId, 'model:upload');

    const existing = await prisma.fence.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ограждение не найдено', statusCode: 404 });
    }

    const parsed = updateFenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, statusCode: 400 });
    }

    const updated = await prisma.fence.update({ where: { id }, data: parsed.data });

    const payload = toPayload(updated);
    emitFenceChanged(fastify, projectId, payload);
    return reply.send(payload);
  });

  // ── DELETE /api/projects/:projectId/fences/:id ──
  fastify.delete('/:projectId/fences/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    await requirePermission(request, projectId, 'model:upload');

    const existing = await prisma.fence.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ограждение не найдено', statusCode: 404 });
    }

    await prisma.fence.delete({ where: { id } });
    emitFenceChanged(fastify, projectId, { id, deleted: true });
    logActivity(fastify, { projectId, actorId: request.user.userId, action: 'fence.delete', targetName: existing.name });
    return reply.code(204).send();
  });
}
