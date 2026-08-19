import { AccountLevel, ProjectRole, type Permission } from '../types';

// ═══════════════════════════════════════════════
// Role Hierarchy & Permissions
// ═══════════════════════════════════════════════

/**
 * Role hierarchy: higher index = more permissions.
 * MASTER > DESIGNER > SUPER_SPECTATOR > SPECTATOR > EXTERNAL_SPECTATOR
 */
export const ROLE_HIERARCHY: ProjectRole[] = [
  ProjectRole.EXTERNAL_SPECTATOR,
  ProjectRole.SPECTATOR,
  ProjectRole.SUPER_SPECTATOR,
  ProjectRole.DESIGNER,
  ProjectRole.MASTER,
];

/**
 * Permissions granted to each role.
 * Roles inherit permissions from lower roles.
 */
export const ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  [ProjectRole.EXTERNAL_SPECTATOR]: [
    'project:read',
  ],

  [ProjectRole.SPECTATOR]: [
    'project:read',
    'comment:write',
  ],

  [ProjectRole.SUPER_SPECTATOR]: [
    'project:read',
    'comment:write',
    'utility:read',
  ],

  [ProjectRole.DESIGNER]: [
    'project:read',
    'comment:write',
    'utility:read',
    'model:upload',
    'model:update',
    'model:delete',
  ],

  [ProjectRole.MASTER]: [
    'project:read',
    'project:update',
    'project:delete',
    'project:manage_members',
    'comment:write',
    'utility:read',
    'model:upload',
    'model:update',
    'model:delete',
  ],
};

/**
 * Human-readable labels for roles (Russian).
 */
export const ROLE_LABELS: Record<ProjectRole, string> = {
  [ProjectRole.MASTER]: 'Мастер',
  [ProjectRole.DESIGNER]: 'Проектировщик',
  [ProjectRole.SUPER_SPECTATOR]: 'Супер-зритель',
  [ProjectRole.SPECTATOR]: 'Зритель',
  [ProjectRole.EXTERNAL_SPECTATOR]: 'Внешний зритель',
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: ProjectRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes(permission);
}

/**
 * Check if role A is equal or higher than role B in hierarchy.
 */
export function hasRoleLevel(roleA: ProjectRole, roleB: ProjectRole): boolean {
  return ROLE_HIERARCHY.indexOf(roleA) >= ROLE_HIERARCHY.indexOf(roleB);
}

// ═══════════════════════════════════════════════
// Уровни доступа к продукту
// ═══════════════════════════════════════════════

/**
 * Числа лежат здесь, а не в бэкенде, намеренно.
 *
 * Кабинет пишет «осталось 2 из 3», а сервер отказывает на четвёртом — эти
 * два места обязаны считать одинаково. Если предел живёт только на сервере,
 * интерфейс рано или поздно начнёт обещать не то, что произойдёт.
 */

export const LEVEL_LABELS: Record<AccountLevel, string> = {
  [AccountLevel.MASTER_UNLIMITED]: 'Мастер без ограничений',
  [AccountLevel.MASTER]: 'Мастер',
  [AccountLevel.DESIGNER]: 'Проектировщик',
  [AccountLevel.SUPER_SPECTATOR]: 'Супер-зритель',
  [AccountLevel.SPECTATOR]: 'Зритель',
};

/** Сколько своих проектов разрешено. null — без счёта */
export const LEVEL_PROJECT_LIMIT: Record<AccountLevel, number | null> = {
  [AccountLevel.MASTER_UNLIMITED]: null,
  [AccountLevel.MASTER]: 3,
  [AccountLevel.DESIGNER]: 0,
  [AccountLevel.SUPER_SPECTATOR]: 0,
  [AccountLevel.SPECTATOR]: 0,
};

/**
 * Выше этой роли человека нельзя позвать в чужой проект.
 *
 * Мастером в чужом проекте зритель не станет, даже если хозяин проекта очень
 * хочет: иначе уровень обходился бы одним приглашением.
 */
export const LEVEL_MAX_ROLE: Record<AccountLevel, ProjectRole> = {
  [AccountLevel.MASTER_UNLIMITED]: ProjectRole.MASTER,
  [AccountLevel.MASTER]: ProjectRole.MASTER,
  [AccountLevel.DESIGNER]: ProjectRole.DESIGNER,
  [AccountLevel.SUPER_SPECTATOR]: ProjectRole.SUPER_SPECTATOR,
  [AccountLevel.SPECTATOR]: ProjectRole.SPECTATOR,
};

/** Может ли человек заводить свои проекты — вопрос только предела */
export const canCreateProjects = (level: AccountLevel): boolean =>
  LEVEL_PROJECT_LIMIT[level] !== 0;

/** Допустима ли роль в проекте для этого уровня */
export const roleAllowedAtLevel = (level: AccountLevel, role: ProjectRole): boolean =>
  hasRoleLevel(LEVEL_MAX_ROLE[level], role);
