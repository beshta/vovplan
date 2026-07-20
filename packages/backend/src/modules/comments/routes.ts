import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole } from '../../utils/permissions.js';
import { emitCommentChanged } from '../../realtime/index.js';

/**
 * Comments / Annotations API
 *
 * GET    /api/projects/:projectId/comments          — list all
 * POST   /api/projects/:projectId/comments          — create (text comment or 3D annotation)
 * PATCH  /api/projects/:projectId/comments/:commentId — update (resolve, edit text)
 * DELETE /api/projects/:projectId/comments/:commentId — delete
 */

const createCommentSchema = z.object({
  text: z.string().min(1).max(5000),
  objectId: z.string().optional(),
  anchor: z.array(z.number()).optional(),
  // 3D annotation fields
  type: z.enum(['arrow', 'line', 'freehand', 'pin']).optional(),
  geometry: z.array(z.array(z.number()).length(3)).optional(),
  color: z.string().optional(),
  width: z.number().min(0.05).max(5).optional(),
  parentId: z.string().optional(),
});

const updateCommentSchema = z.object({
  text: z.string().min(1).max(5000).optional(),
  resolved: z.boolean().optional(),
  color: z.string().optional(),
  width: z.number().min(0.05).max(5).optional(),
});

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /comments — list all comments/annotations ──
  fastify.get('/:projectId/comments', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден' });
    }

    const comments = await prisma.comment.findMany({
      where: { projectId },
      include: {
        author: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({
      data: comments.map((c) => ({
        id: c.id,
        projectId: c.projectId,
        objectId: c.objectId,
        anchor: c.anchor,
        authorId: c.authorId,
        authorName: c.author.displayName,
        text: c.text,
        resolved: c.resolved,
        parentId: c.parentId,
        type: c.type,
        geometry: c.geometry,
        color: c.color,
        width: c.width,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  });

  // ── POST /comments — create comment or 3D annotation ──
  fastify.post('/:projectId/comments', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден' });
    }

    // SUPER_SPECTATOR+ can create annotations; SPECTATOR can comment (read-only? No — comments allowed for all)
    // Everyone with access can create comments

    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    }
    const data = parsed.data;

    const comment = await prisma.comment.create({
      data: {
        projectId,
        objectId: data.objectId ?? null,
        anchor: data.anchor ? JSON.parse(JSON.stringify(data.anchor)) : undefined,
        authorId: userId,
        text: data.text,
        type: data.type ?? null,
        geometry: data.geometry ? JSON.parse(JSON.stringify(data.geometry)) : undefined,
        color: data.color ?? null,
        width: data.width ?? null,
        parentId: data.parentId ?? null,
      },
      include: {
        author: { select: { id: true, displayName: true } },
      },
    });

    request.log.info({ projectId, commentId: comment.id, type: comment.type }, 'Comment/annotation created');

    const payload = {
      id: comment.id,
      projectId: comment.projectId,
      objectId: comment.objectId,
      anchor: comment.anchor,
      authorId: comment.authorId,
      authorName: comment.author.displayName,
      text: comment.text,
      resolved: comment.resolved,
      parentId: comment.parentId,
      type: comment.type,
      geometry: comment.geometry,
      color: comment.color,
      width: comment.width,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
    emitCommentChanged(fastify, projectId, payload);
    return reply.code(201).send(payload);
  });

  // ── PATCH /comments/:commentId — update (resolve, edit) ──
  fastify.patch('/:projectId/comments/:commentId', async (request, reply) => {
    const { projectId, commentId } = request.params as { projectId: string; commentId: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден' });
    }

    const parsed = updateCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    }
    const data = parsed.data;

    // Only author or MASTER can edit
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Комментарий не найден' });
    }
    if (existing.authorId !== userId && role !== 'MASTER') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет прав на редактирование' });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        ...(data.text !== undefined && { text: data.text }),
        ...(data.resolved !== undefined && { resolved: data.resolved }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.width !== undefined && { width: data.width }),
      },
      include: {
        author: { select: { id: true, displayName: true } },
      },
    });

    const payload = {
      id: updated.id,
      projectId: updated.projectId,
      objectId: updated.objectId,
      anchor: updated.anchor,
      authorId: updated.authorId,
      authorName: updated.author.displayName,
      text: updated.text,
      resolved: updated.resolved,
      parentId: updated.parentId,
      type: updated.type,
      geometry: updated.geometry,
      color: updated.color,
      width: updated.width,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
    emitCommentChanged(fastify, projectId, payload);
    return reply.send(payload);
  });

  // ── DELETE /comments/:commentId ──
  fastify.delete('/:projectId/comments/:commentId', async (request, reply) => {
    const { projectId, commentId } = request.params as { projectId: string; commentId: string };
    const userId = request.user.userId;

    const role = await getUserRole(userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден' });
    }

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Комментарий не найден' });
    }
    if (existing.authorId !== userId && role !== 'MASTER') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет прав на удаление' });
    }

    await prisma.comment.delete({ where: { id: commentId } });

    emitCommentChanged(fastify, projectId, { id: commentId, deleted: true });
    return reply.code(204).send();
  });
}
