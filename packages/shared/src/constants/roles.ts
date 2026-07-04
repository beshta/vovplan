import { ProjectRole, type Permission } from '../types';

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
