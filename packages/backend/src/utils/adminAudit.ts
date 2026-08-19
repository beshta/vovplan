import prisma from '../db/prisma.js';

/**
 * Журнал действий хозяина сервиса. Только на добавление.
 *
 * В отличие от ленты активности проекта (`utils/activity.ts`), запись здесь
 * **дожидается** записи в базу, а не уходит вдогонку. Пропавшая строчка в
 * ленте проекта — мелкая неприятность; пропавшая строчка здесь означает
 * блокировку или выдачу прав, которых как будто не было. Если журнал не
 * записался, действие не выполняется.
 */

/**
 * Что записываем. Перечислением, а не свободной строкой: опечатка в названии
 * не сломает запись, но навсегда спрячет действие от любого поиска по
 * журналу — а искать в нём будут именно тогда, когда что-то случилось.
 */
export type AdminActionName =
  | 'admin.ban'
  | 'admin.unban'
  | 'admin.grant'
  | 'admin.revoke'
  | 'admin.totp-enable'
  | 'admin.totp-reset'
  | 'admin.level'
  | 'admin.project-delete'
  | 'admin.project-restore'
  | 'admin.project-purge'
  | 'admin.project-public'
  | 'admin.project-feature'
  | 'admin.project-inspect';

/**
 * Как звали цель на момент действия.
 *
 * Строкой, а не ссылкой: пользователя могут удалить, а запись обязана
 * остаться читаемой. Журнал, в котором вместо человека стоит мёртвый
 * идентификатор, не отвечает на вопрос «кого именно заблокировали».
 */
export const labelOf = (user: { displayName: string; email: string }): string =>
  `${user.displayName} <${user.email}>`;

export async function logAdminAction(params: {
  actorId: string;
  action: AdminActionName;
  targetUserId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  const { actorId, action, targetUserId, targetLabel, details, ip } = params;

  await prisma.adminAction.create({
    data: {
      actorId,
      action,
      targetUserId: targetUserId ?? null,
      targetLabel: targetLabel ?? null,
      details: (details ?? undefined) as never,
      ip: ip ?? null,
    },
  });
}
