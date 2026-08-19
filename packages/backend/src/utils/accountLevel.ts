import { ProjectRole } from '@prisma/client';
import {
  AccountLevel,
  LEVEL_LABELS,
  LEVEL_MAX_ROLE,
  LEVEL_PROJECT_LIMIT,
  ROLE_LABELS,
  ProjectRole as SharedRole,
  roleAllowedAtLevel,
} from '@vovplan/shared';
import prisma from '../db/prisma.js';
import { HttpError } from './errors.js';

/**
 * Уровень доступа к продукту: что человеку вообще позволено.
 *
 * Вся арифметика собрана здесь одним файлом не для красоты. Систему подписок
 * будут переделывать, и тогда меняться должно одно место, а не десяток
 * маршрутов, каждый со своим представлением о том, кому что можно.
 *
 * Проверка идёт по базе, а не по токену: уровень снимают в админке, и токен
 * при этом не перевыпускается. Уровень из токена жил бы неделю после снятия.
 */

const levelOf = async (userId: string): Promise<AccountLevel> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountLevel: true },
  });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Пользователь не найден');
  return user.accountLevel as unknown as AccountLevel;
};

/**
 * Можно ли завести ещё один свой проект.
 *
 * Считаются проекты, где человек мастер и которые не в корзине: удалённый
 * занимал бы место в пределе, хотя его нигде не видно, — и человек упирался
 * бы в лимит, не понимая почему.
 */
export async function assertCanCreateProject(userId: string): Promise<void> {
  const level = await levelOf(userId);
  const limit = LEVEL_PROJECT_LIMIT[level];

  if (limit === null) return;

  if (limit === 0) {
    throw new HttpError(
      403,
      'LEVEL_FORBIDDEN',
      `Уровень «${LEVEL_LABELS[level]}» не позволяет создавать проекты — только работать в чужих по приглашению`,
    );
  }

  const mine = await prisma.projectMember.count({
    where: { userId, role: ProjectRole.MASTER, project: { deletedAt: null } },
  });

  if (mine >= limit) {
    throw new HttpError(
      403,
      'LEVEL_LIMIT',
      `Достигнут предел уровня «${LEVEL_LABELS[level]}»: ${limit} ${plural(limit)}. Удалите ненужный или повысьте уровень`,
    );
  }
}

/**
 * Не выше потолка: зрителя нельзя позвать мастером.
 *
 * Проверяется при выдаче роли, а не при её использовании. Иначе уровень
 * обходился бы одним приглашением: позвали мастером — и предел на свои
 * проекты перестал что-либо значить, чужой проект ничем не хуже своего.
 */
export async function assertRoleAllowed(userId: string, role: ProjectRole): Promise<void> {
  const level = await levelOf(userId);

  if (!roleAllowedAtLevel(level, role as unknown as SharedRole)) {
    throw new HttpError(
      403,
      'LEVEL_FORBIDDEN',
      `Уровень «${LEVEL_LABELS[level]}» не позволяет роль выше «${ROLE_LABELS[LEVEL_MAX_ROLE[level]]}»`,
    );
  }
}

/** Сколько своих проектов уже занято и сколько всего можно */
export async function projectQuota(userId: string): Promise<{ used: number; limit: number | null }> {
  const level = await levelOf(userId);
  const used = await prisma.projectMember.count({
    where: { userId, role: ProjectRole.MASTER, project: { deletedAt: null } },
  });
  return { used, limit: LEVEL_PROJECT_LIMIT[level] };
}

const plural = (n: number) => (n === 1 ? 'проект' : n < 5 ? 'проекта' : 'проектов');
