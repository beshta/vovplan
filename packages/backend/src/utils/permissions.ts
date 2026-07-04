import type { FastifyRequest } from 'fastify';
import { Prisma, type ProjectRole } from '@prisma/client';
import { hasPermission as checkPerm, hasRoleLevel } from '@vovplan/shared';
import type { Permission } from '@vovplan/shared';
import prisma from '../db/prisma.js';

/**
 * Get the user's role in a specific project.
 * Returns null if user is not a member.
 */
export async function getUserRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

/**
 * Require a specific permission for a project.
 * Throws 403 if the user lacks the permission.
 */
export async function requirePermission(
  request: FastifyRequest,
  projectId: string,
  permission: Permission,
): Promise<ProjectRole> {
  const userId = request.user.userId;
  const role = await getUserRole(userId, projectId);

  if (!role) {
    throw { statusCode: 404, error: 'NOT_FOUND', message: 'Проект не найден или нет доступа' };
  }

  // Map Prisma enum to shared enum
  const sharedRole = role as unknown as import('@vovplan/shared').ProjectRole;

  if (!checkPerm(sharedRole, permission)) {
    throw { statusCode: 403, error: 'FORBIDDEN', message: 'Недостаточно прав' };
  }

  return role;
}

/**
 * Require the user to be MASTER of a project.
 */
export async function requireMaster(request: FastifyRequest, projectId: string): Promise<void> {
  const userId = request.user.userId;
  const role = await getUserRole(userId, projectId);

  if (!role || !hasRoleLevel(role as unknown as import('@vovplan/shared').ProjectRole, import('@vovplan/shared').ProjectRole.MASTER)) {
    throw { statusCode: 403, error: 'FORBIDDEN', message: 'Требуются права Мастера' };
  }
}
