import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission } from '../../utils/permissions.js';
import { emitUtilityChanged } from '../../realtime/index.js';

// Geometry: array of [x, y, z] points — a polyline in local scene coordinates
const geometrySchema = z.array(z.array(z.number()).length(3)).min(2);

const createUtilitySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['WATER', 'GAS', 'ELECTRIC', 'SEWAGE', 'TELECOM', 'HEAT']),
  location: z.enum(['UNDERGROUND', 'OVERHEAD']),
  geometry: geometrySchema,
  depth: z.number().optional(),         // burial depth (meters), for underground
  diameter: z.number().optional(),      // pipe diameter (mm)
  material: z.string().optional(),      // e.g. "steel", "PVC", "copper"
  color: z.string().optional(),         // override default color
});

const updateUtilitySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['WATER', 'GAS', 'ELECTRIC', 'SEWAGE', 'TELECOM', 'HEAT']).optional(),
  location: z.enum(['UNDERGROUND', 'OVERHEAD']).optional(),
  geometry: geometrySchema.optional(),
  depth: z.number().optional(),
  diameter: z.number().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
});

export default async function utilityRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/projects/:projectId/utilities ──
  fastify.get('/:projectId/utilities', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const role = await getUserRole(request.user.userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const utilities = await prisma.utilityNetwork.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    const data = utilities.map((u) => ({
      id: u.id,
      name: u.name,
      type: u.type,
      location: u.location,
      geometry: u.geometry as [number, number, number][],
      depth: u.depth ?? null,
      diameter: u.diameter ?? null,
      material: u.material ?? null,
      color: u.color,
    }));

    return reply.send({ data });
  });

  // ── POST /api/projects/:projectId/utilities ──
  fastify.post('/:projectId/utilities', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = createUtilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const util = await prisma.utilityNetwork.create({
      data: {
        projectId,
        name: parsed.data.name,
        type: parsed.data.type,
        location: parsed.data.location,
        geometry: parsed.data.geometry,
        depth: parsed.data.depth ?? null,
        diameter: parsed.data.diameter ?? null,
        material: parsed.data.material ?? null,
        color: parsed.data.color ?? defaultColorForType(parsed.data.type),
      },
    });

    const payload = {
      id: util.id,
      name: util.name,
      type: util.type,
      location: util.location,
      geometry: util.geometry as [number, number, number][],
      depth: util.depth ?? null,
      diameter: util.diameter ?? null,
      material: util.material ?? null,
      color: util.color,
    };
    emitUtilityChanged(fastify, projectId, payload);
    return reply.code(201).send(payload);
  });

  // ── PATCH /api/projects/:projectId/utilities/:id ──
  fastify.patch('/:projectId/utilities/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const existing = await prisma.utilityNetwork.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Сеть не найдена', statusCode: 404 });
    }

    const parsed = updateUtilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, statusCode: 400 });
    }

    const updated = await prisma.utilityNetwork.update({
      where: { id },
      data: parsed.data,
    });

    const payload = {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      location: updated.location,
      geometry: updated.geometry as [number, number, number][],
      depth: updated.depth ?? null,
      diameter: updated.diameter ?? null,
      material: updated.material ?? null,
      color: updated.color,
    };
    emitUtilityChanged(fastify, projectId, payload);
    return reply.send(payload);
  });

  // ── DELETE /api/projects/:projectId/utilities/:id ──
  fastify.delete('/:projectId/utilities/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const existing = await prisma.utilityNetwork.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Сеть не найдена', statusCode: 404 });
    }

    await prisma.utilityNetwork.delete({ where: { id } });
    emitUtilityChanged(fastify, projectId, { id, deleted: true });
    return reply.code(204).send();
  });
}

/** Default color for each utility type — follows industry conventions */
function defaultColorForType(type: string): string {
  const colors: Record<string, string> = {
    WATER: '#2563eb',       // синий
    GAS: '#f59e0b',         // жёлтый
    ELECTRIC: '#dc2626',    // красный
    SEWAGE: '#7c3aed',    // фиолетовый
    TELECOM: '#10b981',     // зелёный
    HEAT: '#ea580c',        // оранжевый
  };
  return colors[type] ?? '#6b7280';
}
