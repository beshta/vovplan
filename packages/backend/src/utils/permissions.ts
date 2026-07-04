import type { FastifyRequest } from 'fastify';
import { type ProjectRole as PrismaRole } from '@prisma/client';
import {
  hasPermission as checkPerm,
  hasRoleLevel,
  ProjectRole as SharedRole,
  type Permission,
} from '@vovplan/shared';
import prisma from '../db/prisma.js';

/**
 * Get the user's role in a specific project.
 * Returns null if user is not a member.
 */
export async function getUserRole(userId: string, projectId: string): Promise<PrismaRole | null> {
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
): Promise<PrismaRole> {
  const userId = request.user.userId;
  const role = await getUserRole(userId, projectId);

  if (!role) {
    throw { statusCode: 404, error: 'NOT_FOUND', message: 'Проект не найден или нет доступа' };
  }

  // Prisma enum values are identical strings to shared enum
  const sharedRole = role as unknown as SharedRole;

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

  if (!role || !hasRoleLevel(role as unknown as SharedRole, SharedRole.MASTER)) {
    throw { statusCode: 403, error: 'FORBIDDEN', message: 'Требуются права Мастера' };
  }
}
