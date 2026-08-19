import { AccountLevel } from '@prisma/client';
import { config } from '../config/index.js';
import prisma from '../db/prisma.js';
import { findUserByEmail } from './email.js';
import { logAdminAction, labelOf } from './adminAudit.js';

/**
 * Первый хозяин на новой базе.
 *
 * Почта не в коде, а в `BOOTSTRAP_ADMIN_EMAIL` на сервере: её не увидит ни
 * фронт, ни ответ API. Срабатывает только если в базе ещё нет ни одного
 * администратора — повторный пуш не раздаёт права заново и не восстанавливает
 * того, кого сознательно сняли.
 *
 * Если человек с этой почтой ещё не регистрировался, в лог пишется подсказка
 * и больше ничего: следующий старт подхватит, когда учётка появится.
 */
export async function bootstrapAdmin(
  log?: { info: (msg: string) => void; warn: (msg: string) => void },
  email = config.bootstrapAdminEmail,
): Promise<void> {
  if (!email) return;

  const admins = await prisma.user.count({ where: { isAdmin: true } });
  if (admins > 0) return;

  const user = await findUserByEmail(email);
  if (!user) {
    log?.warn(
      `BOOTSTRAP_ADMIN_EMAIL задан, но пользователь ещё не регистрировался. ` +
        `Создайте аккаунт и перезапустите — права выдадутся сами.`,
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: true, accountLevel: AccountLevel.MASTER_UNLIMITED },
  });

  await logAdminAction({
    actorId: user.id,
    action: 'admin.grant',
    targetUserId: user.id,
    targetLabel: labelOf(user),
    details: { via: 'BOOTSTRAP_ADMIN_EMAIL' },
  });

  log?.info(`${labelOf(user)} — первый администратор (BOOTSTRAP_ADMIN_EMAIL).`);
}
