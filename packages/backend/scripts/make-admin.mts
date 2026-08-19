/**
 * Завести первого администратора.
 *
 * Единственный способ выдать права снаружи — и он намеренно требует доступа
 * к серверу и базе. Дальше права выдаются из самой панели, где каждое
 * действие попадает в журнал с именем того, кто его совершил.
 *
 * Скрипт остаётся в репозитории не «на всякий случай», а как путь
 * восстановления: если последний хозяин потерял и телефон, и резервные коды,
 * снять второй фактор можно только отсюда.
 *
 * Запуск:
 *   npx tsx scripts/make-admin.mts почта@пример.рф
 *   npx tsx scripts/make-admin.mts почта@пример.рф --reset-2fa
 */
import { AccountLevel } from '@prisma/client';
import prisma from '../src/db/prisma.js';
import { findUserByEmail } from '../src/utils/email.js';
import { logAdminAction, labelOf } from '../src/utils/adminAudit.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const resetTotp = args.includes('--reset-2fa');

if (!email) {
  console.error('Укажите почту: npx tsx scripts/make-admin.mts почта@пример.рф [--reset-2fa]');
  process.exit(1);
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`Пользователь ${email} не найден. Сначала зарегистрируйтесь в приложении.`);
  process.exit(1);
}

const granting = !user.isAdmin;
// Хозяину сервиса упереться в предел из трёх проектов было бы странно: он и
// снимет его сам, только через лишний заход в собственную панель
const levelling = user.accountLevel !== AccountLevel.MASTER_UNLIMITED;

if (user.isAdmin && !resetTotp && !levelling) {
  console.log(`${labelOf(user)} — уже администратор с безлимитным уровнем. Ничего не изменено.`);
  console.log('Сбросить второй фактор: добавьте --reset-2fa');
  process.exit(0);
}

await prisma.user.update({
  where: { id: user.id },
  data: {
    isAdmin: true,
    accountLevel: AccountLevel.MASTER_UNLIMITED,
    ...(resetTotp ? { totpSecret: null, totpEnabled: null } : {}),
  },
});

if (resetTotp) {
  await prisma.totpBackupCode.deleteMany({ where: { userId: user.id } });
}

/*
 * Запись в журнал обязательна и здесь. Права, выданные молча, — ровно то, от
 * чего мы ушли, отказавшись от списка почт в переменной окружения: изменение
 * без следа нельзя ни к кому привязать. Действующим лицом стоит сам
 * пользователь: другого имени у запуска с сервера нет, и притворяться, что
 * есть, хуже, чем сказать честно.
 *
 * Действия пишутся по отдельности: «выдал права» и «сбросил второй фактор» —
 * разные события, и по журналу должно быть видно, что именно произошло.
 */
const via = { via: 'scripts/make-admin.mts' };
if (granting) {
  await logAdminAction({
    actorId: user.id,
    action: 'admin.grant',
    targetUserId: user.id,
    targetLabel: labelOf(user),
    details: via,
  });
}
if (resetTotp) {
  await logAdminAction({
    actorId: user.id,
    action: 'admin.totp-reset',
    targetUserId: user.id,
    targetLabel: labelOf(user),
    details: via,
  });
}
if (levelling) {
  await logAdminAction({
    actorId: user.id,
    action: 'admin.level',
    targetUserId: user.id,
    targetLabel: labelOf(user),
    details: { ...via, from: user.accountLevel, to: AccountLevel.MASTER_UNLIMITED },
  });
}

console.log(`${labelOf(user)} — администратор.`);
if (levelling) console.log('Уровень доступа: мастер без ограничений.');
if (resetTotp) console.log('Второй фактор сброшен: подключите заново в панели.');
console.log('Дальше: войдите в приложение и откройте админку — она попросит подключить второй фактор.');

await prisma.$disconnect();
