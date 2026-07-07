import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission } from '../../utils/permissions.js';

const createObjectSchema = z.object({
  name: z.string().min(1).max(200),
  modelId: z.string().optional(),
  position: z.array(z.number()).length(3),
  rotation: z.array(z.number()).length(3).optional().default([0, 0, 0]),
  scale: z.array(z.number()).length(3).optional().default([1, 1, 1]),
  description: z.string().max(2000).optional(),
  docUrl: z.string().url().max(500).optional().or(z.literal('')),
});

const updateObjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.array(z.number()).length(3).optional(),
  rotation: z.array(z.number()).length(3).optional(),
  scale: z.array(z.number()).length(3).optional(),
  visible: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  docUrl: z.string().url().max(500).optional().or(z.literal('')),
  locked: z.boolean().optional(),
});

export default async function sceneRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/projects/:projectId/objects ──
  fastify.get('/:projectId/objects', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    // Master sees all; others only see visible=true
    const where = role === 'MASTER' ? { projectId } : { projectId, visible: true };
    const objects = await prisma.sceneObject.findMany({
      where,
      include: { author: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const data = objects.map((o) => ({
      id: o.id,
      modelId: o.modelId ?? '',
      name: o.name,
      authorId: o.authorId,
      authorName: o.author.displayName,
      position: o.position as [number, number, number],
      rotation: o.rotation as [number, number, number],
      scale: o.scale as [number, number, number],
      visible: o.visible,
      hidden: !o.visible,
      description: o.description ?? '',
      docUrl: o.docUrl ?? '',
      createdAt: o.createdAt.toISOString(),
      locked: o.locked,
    }));

    return reply.send({ data });
  });

  // ── POST /api/projects/:projectId/scene/objects ──
  fastify.post('/:projectId/objects', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = createObjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { name, modelId, position, rotation, scale, description, docUrl } = parsed.data;
    const obj = await prisma.sceneObject.create({
      data: {
        projectId,
        modelId: modelId ?? null,
        name,
        position: position,
        rotation: rotation,
        scale: scale,
        authorId: request.user.userId,
        description: description ?? null,
        docUrl: docUrl || null,
      },
      include: { author: { select: { id: true, displayName: true } } },
    });

    return reply.code(201).send({
      id: obj.id,
      modelId: obj.modelId ?? '',
      name: obj.name,
      authorId: obj.authorId,
      authorName: obj.author.displayName,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      visible: obj.visible,
      hidden: false,
      description: obj.description ?? '',
      docUrl: obj.docUrl ?? '',
      createdAt: obj.createdAt.toISOString(),
      locked: obj.locked,
    });
  });

  // ── PATCH /api/projects/:projectId/scene/objects/:id ──
  fastify.patch('/:projectId/objects/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const existing = await prisma.sceneObject.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Объект не найден', statusCode: 404 });
    }

    const isMaster = role === 'MASTER';
    const isOwner = existing.authorId === userId;
    if (!isMaster && !isOwner) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Можно редактировать только свои объекты', statusCode: 403 });
    }

    const parsed = updateObjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, statusCode: 400 });
    }

    const updated = await prisma.sceneObject.update({
      where: { id },
      data: parsed.data,
    });

    return reply.send({
      ...updated,
      position: updated.position as [number, number, number],
      rotation: updated.rotation as [number, number, number],
      scale: updated.scale as [number, number, number],
      hidden: !updated.visible,
    });
  });

  // ── DELETE /api/projects/:projectId/scene/objects/:id ──
  // Designers: soft-delete (visible=false). Master: hard delete if already hidden.
  fastify.delete('/:projectId/objects/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const existing = await prisma.sceneObject.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Объект не найден', statusCode: 404 });
    }

    const isMaster = role === 'MASTER';
    const isOwner = existing.authorId === userId;
    if (!isMaster && !isOwner) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Можно удалять только свои объекты', statusCode: 403 });
    }

    if (isMaster && !existing.visible) {
      // Master hard-deletes already-hidden objects
      await prisma.sceneObject.delete({ where: { id } });
      return reply.code(204).send();
    }

    // Soft-delete: mark as hidden
    const updated = await prisma.sceneObject.update({
      where: { id },
      data: { visible: false },
    });

    return reply.code(200).send({ id: updated.id, hidden: true });
  });

  // ── POST /api/projects/:projectId/scene/objects/:id/restore ──
  fastify.post('/:projectId/objects/:id/restore', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requirePermission(request, projectId, 'project:update');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const updated = await prisma.sceneObject.update({
      where: { id },
      data: { visible: true },
    });

    return reply.send({ id: updated.id, restored: true });
  });
}
