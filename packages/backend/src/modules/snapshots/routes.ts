import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission, requireMaster } from '../../utils/permissions.js';
import { logActivity } from '../../utils/activity.js';
import {
  emitObjectChanged, emitUtilityChanged, emitCommentChanged,
} from '../../realtime/index.js';

/**
 * История версий сцены.
 *   POST   /:projectId/snapshots               — сохранить текущее состояние (DESIGNER+)
 *   GET    /:projectId/snapshots               — список версий (участник)
 *   POST   /:projectId/snapshots/:id/restore   — восстановить (MASTER)
 *   DELETE /:projectId/snapshots/:id           — удалить версию (MASTER)
 *
 * Снимок собирается из БД (объекты + инж.сети + аннотации + ландшафт).
 * Модели (GLB) хранятся ссылками, файлы не копируются.
 */

const createSchema = z.object({ name: z.string().min(1).max(120) });

export default async function snapshotRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── Список версий (без тяжёлого data) ──
  fastify.get('/:projectId/snapshots', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const role = await getUserRole(request.user.userId, projectId);
    if (!role) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });

    const snaps = await prisma.sceneSnapshot.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    // Автор денормализуем отдельным запросом (мало записей)
    const authorIds = [...new Set(snaps.map((s) => s.createdById))];
    const authors = await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } });
    const nameOf = new Map(authors.map((a) => [a.id, a.displayName]));

    return reply.send({
      data: snaps.map((s) => {
        const d = s.data as any;
        return {
          id: s.id,
          name: s.name,
          createdAt: s.createdAt.toISOString(),
          authorName: nameOf.get(s.createdById) ?? '—',
          counts: d?.counts ?? { objects: 0, utilities: 0, annotations: 0 },
        };
      }),
    });
  });

  // ── Сохранить текущее состояние ──
  fastify.post('/:projectId/snapshots', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try { await requirePermission(request, projectId, 'model:upload'); }
    catch (err: any) { return reply.code(err.statusCode ?? 500).send(err); }

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, statusCode: 400 });
    }

    const [objects, utilities, annotations, project] = await Promise.all([
      prisma.sceneObject.findMany({ where: { projectId } }),
      prisma.utilityNetwork.findMany({ where: { projectId } }),
      prisma.comment.findMany({ where: { projectId, type: { not: null } } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { terrainUrl: true, terrainMeta: true } }),
    ]);

    const data = {
      objects: objects.map((o) => ({
        name: o.name, modelId: o.modelId, position: o.position, rotation: o.rotation,
        scale: o.scale, visible: o.visible, description: o.description, docUrl: o.docUrl,
        locked: o.locked, groundSnap: o.groundSnap, authorId: o.authorId,
      })),
      utilities: utilities.map((u) => ({
        name: u.name, type: u.type, location: u.location, geometry: u.geometry,
        depth: u.depth, diameter: u.diameter, material: u.material, color: u.color,
      })),
      annotations: annotations.map((c) => ({
        text: c.text, type: c.type, geometry: c.geometry, color: c.color,
        width: c.width, resolved: c.resolved, authorId: c.authorId,
      })),
      terrainUrl: project?.terrainUrl ?? null,
      terrainMeta: project?.terrainMeta ?? null,
      counts: { objects: objects.length, utilities: utilities.length, annotations: annotations.length },
    };

    const snap = await prisma.sceneSnapshot.create({
      data: { projectId, name: parsed.data.name, createdById: request.user.userId, data: data as any },
    });
    logActivity(fastify, { projectId, actorId: request.user.userId, action: 'snapshot.create', targetName: snap.name });

    return reply.code(201).send({ id: snap.id, name: snap.name, createdAt: snap.createdAt.toISOString(), counts: data.counts });
  });

  // ── Восстановить версию (заменяет объекты/сети/аннотации проекта) ──
  fastify.post('/:projectId/snapshots/:id/restore', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    try { await requireMaster(request, projectId); }
    catch (err: any) { return reply.code(err.statusCode ?? 500).send(err); }

    const snap = await prisma.sceneSnapshot.findUnique({ where: { id } });
    if (!snap || snap.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Версия не найдена', statusCode: 404 });
    }
    const d = snap.data as any;
    const restorer = request.user.userId;

    // FK authorId должен указывать на существующего участника — иначе восстанавливающий.
    const members = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
    const valid = new Set(members.map((m) => m.userId));
    const authorOf = (aid: string) => (valid.has(aid) ? aid : restorer);

    // Транзакция: снести текущее, восстановить из снимка. Аннотации — только
    // те, что с type (3D); текстовые комментарии не трогаем.
    await prisma.$transaction([
      prisma.sceneObject.deleteMany({ where: { projectId } }),
      prisma.utilityNetwork.deleteMany({ where: { projectId } }),
      prisma.comment.deleteMany({ where: { projectId, type: { not: null } } }),
      ...(d.objects ?? []).map((o: any) =>
        prisma.sceneObject.create({ data: {
          projectId, name: o.name, modelId: o.modelId ?? null,
          position: o.position, rotation: o.rotation, scale: o.scale,
          visible: o.visible ?? true, description: o.description ?? null, docUrl: o.docUrl ?? null,
          locked: o.locked ?? true, groundSnap: o.groundSnap ?? true, authorId: authorOf(o.authorId),
        } })),
      ...(d.utilities ?? []).map((u: any) =>
        prisma.utilityNetwork.create({ data: {
          projectId, name: u.name, type: u.type, location: u.location, geometry: u.geometry,
          depth: u.depth ?? null, diameter: u.diameter ?? null, material: u.material ?? null, color: u.color,
        } })),
      ...(d.annotations ?? []).map((a: any) =>
        prisma.comment.create({ data: {
          projectId, text: a.text, type: a.type, geometry: a.geometry, color: a.color ?? null,
          width: a.width ?? null, resolved: a.resolved ?? false, authorId: authorOf(a.authorId),
        } })),
      prisma.project.update({ where: { id: projectId }, data: { terrainUrl: d.terrainUrl ?? null, terrainMeta: (d.terrainMeta ?? null) as any } }),
    ]);

    logActivity(fastify, { projectId, actorId: restorer, action: 'snapshot.restore', targetName: snap.name });
    // Просим всех перечитать сцену (объём изменений большой — точечные эмиты не шлём)
    emitObjectChanged(fastify, projectId, { restored: true });
    emitUtilityChanged(fastify, projectId, { restored: true });
    emitCommentChanged(fastify, projectId, { restored: true });

    return reply.send({ restored: true, counts: d.counts });
  });

  // ── Удалить версию ──
  fastify.delete('/:projectId/snapshots/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    try { await requireMaster(request, projectId); }
    catch (err: any) { return reply.code(err.statusCode ?? 500).send(err); }

    const snap = await prisma.sceneSnapshot.findUnique({ where: { id } });
    if (!snap || snap.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Версия не найдена', statusCode: 404 });
    }
    await prisma.sceneSnapshot.delete({ where: { id } });
    return reply.code(204).send();
  });
}
