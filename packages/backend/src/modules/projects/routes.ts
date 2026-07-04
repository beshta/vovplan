import type { FastifyInstance } from 'fastify';
import { createProjectSchema, updateProjectSchema, inviteMemberSchema } from '@vovplan/shared';
import { ProjectRole, ProjectStatus } from '@prisma/client';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission, requireMaster } from '../../utils/permissions.js';

// Shape mapper: Prisma row → API response
function toProjectDTO(row: any, myRole?: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    bounds: row.bounds,
    centerLat: row.centerLat,
    centerLng: row.centerLng,
    terrainUrl: row.terrainUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    myRole,
  };
}

export default async function projectRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/projects — list projects I'm a member of ──
  fastify.get('/', async (request, reply) => {
    const userId = request.user.userId;

    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      include: {
        project: true,
      },
      orderBy: { project: { updatedAt: 'desc' } },
    });

    const projects = memberships.map((m) => toProjectDTO(m.project, m.role));
    return reply.send({ data: projects });
  });

  // ── POST /api/projects — create a new project ──
  fastify.post('/', async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const userId = request.user.userId;
    const { name, description, centerLat, centerLng, bounds } = parsed.data;

    // Create project + creator as MASTER in a transaction
    const project = await prisma.$transaction(async (tx) => {
      const proj = await tx.project.create({
        data: {
          name,
          description,
          centerLat,
          centerLng,
          bounds: bounds as any,
          status: ProjectStatus.DRAFT,
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: proj.id,
          userId,
          role: ProjectRole.MASTER,
        },
      });

      return proj;
    });

    return reply.code(201).send(toProjectDTO(project, ProjectRole.MASTER));
  });

  // ── GET /api/projects/:id — get one project ──
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const role = await getUserRole(request.user.userId, id);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден или нет доступа', statusCode: 404 });
    }

    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    return reply.send(toProjectDTO(project, role));
  });

  // ── PATCH /api/projects/:id — update project ──
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await requirePermission(request, id, 'project:update');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: parsed.data,
    });

    const role = await getUserRole(request.user.userId, id);
    return reply.send(toProjectDTO(updated, role ?? undefined));
  });

  // ── DELETE /api/projects/:id — delete project (MASTER only) ──
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await requireMaster(request, id);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    await prisma.project.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ── GET /api/projects/:id/members — list members ──
  fastify.get('/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await requirePermission(request, id, 'project:read');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const members = await prisma.projectMember.findMany({
      where: { projectId: id },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({ data: members });
  });

  // ── POST /api/projects/:id/members — invite member ──
  fastify.post('/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await requireMaster(request, id);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const parsed = inviteMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, role } = parsed.data;

    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден', statusCode: 404 });
    }

    // Check not already member
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: userToAdd.id } },
    });
    if (existing) {
      return reply.code(409).send({ error: 'CONFLICT', message: 'Уже участник проекта', statusCode: 409 });
    }

    const member = await prisma.projectMember.create({
      data: {
        projectId: id,
        userId: userToAdd.id,
        role: role as ProjectRole,
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    return reply.code(201).send(member);
  });

  // ── PATCH /api/projects/:id/members/:userId — change role ──
  fastify.patch('/:id/members/:userId', async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };

    try {
      await requireMaster(request, id);
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    const { role } = request.body as { role: string };

    const updated = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: id, userId } },
      data: { role: role as ProjectRole },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    return reply.send(updated);
  });

  // ── DELETE /api/projects/:id/members/:userId — remove member ──
  fastify.delete('/:id/members/:userId', async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };

    // User can remove themselves, or MASTER can remove anyone
    if (userId !== request.user.userId) {
      try {
        await requireMaster(request, id);
      } catch (err: any) {
        return reply.code(err.statusCode ?? 500).send(err);
      }
    }

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
    });

    if (!member) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Участник не найден', statusCode: 404 });
    }

    // Can't remove the last MASTER
    if (member.role === ProjectRole.MASTER) {
      const masterCount = await prisma.projectMember.count({
        where: { projectId: id, role: ProjectRole.MASTER },
      });
      if (masterCount <= 1) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Нельзя удалить последнего мастера проекта', statusCode: 400 });
      }
    }

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId } },
    });

    return reply.code(204).send();
  });
}
