import type { FastifyRequest } from 'fastify';
import { type ProjectRole as PrismaRole } from '@prisma/client';
import {
  hasPermission as checkPerm,
  hasRoleLevel,
  ProjectRole as SharedRole,
  type Permission,
} from '@vovplan/shared';
import prisma from '../db/prisma.js';
import { HttpError } from './errors.js';

/**
 * Роль человека в проекте. null — не участник или проект в корзине.
 *
 * Проверка удалённого проекта стоит именно здесь, а не в маршрутах списка.
 * Через эту функцию проходят `requirePermission`, `requireMaster` и хендшейк
 * сокетов — то есть вообще всё, что спрашивает «пускать ли». Убери проект из
 * одного списка — и он останется доступен по прямой ссылке, через модель,
 * через комментарии и в комнате совместной работы, потому что участие в базе
 * никуда не делось. Один запрос с присоединённым `deletedAt` закрывает все
 * двери разом, включая те, которых ещё нет.
 */
export async function getUserRole(userId: string, projectId: string): Promise<PrismaRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true, project: { select: { deletedAt: true } } },
  });
  if (!member || member.project.deletedAt) return null;
  return member.role;
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
    throw new HttpError(404, 'NOT_FOUND', 'Проект не найден или нет доступа');
  }

  // Prisma enum values are identical strings to shared enum
  const sharedRole = role as unknown as SharedRole;

  if (!checkPerm(sharedRole, permission)) {
    throw new HttpError(403, 'FORBIDDEN', 'Недостаточно прав');
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
    throw new HttpError(403, 'FORBIDDEN', 'Требуются права Мастера');
  }
}
