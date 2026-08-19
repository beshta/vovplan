import { describe, it, expect, afterAll, vi } from 'vitest';
import { AccountLevel } from '@prisma/client';
import prisma from './db/prisma.js';
import { bootstrapAdmin } from './utils/bootstrapAdmin.js';

/**
 * Первый хозяин с пустой базы.
 *
 * Проверяется инвариант, а не «скрипт отработал»: права выдаются только если
 * администраторов ещё нет, и повторный вызов с другой почтой уже ничего не
 * делает. Иначе переменная окружения стала бы способом захватывать аккаунты
 * при каждом деплое.
 *
 * Чужих администраторов из соседних файлов тестов не трогаем: снять всем
 * `isAdmin` — значит уронить параллельный набор в CI.
 */

const marker = `boottest-${Date.now()}`;

async function makeUser(who: string) {
  return prisma.user.create({
    data: {
      email: `${who}.${marker}@test.vovplan.io`,
      passwordHash: 'not-used',
      displayName: who,
    },
  });
}

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { contains: marker } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.adminAction.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('bootstrap первого хозяина', () => {
  it('пустая почта ничего не делает', async () => {
    await expect(bootstrapAdmin(undefined, '')).resolves.toBeUndefined();
  });

  it('не выдаёт права, если хозяин уже есть', async () => {
    const holder = await makeUser('holder');
    await prisma.user.update({ where: { id: holder.id }, data: { isAdmin: true } });
    const target = await makeUser('target');

    await bootstrapAdmin(undefined, target.email);

    const skipped = await prisma.user.findUnique({ where: { id: target.id } });
    expect(skipped?.isAdmin).toBe(false);
  });

  it('выдаёт права, когда хозяев нет', async () => {
    const existing = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { isAdmin: true },
      data: { isAdmin: false },
    });

    const candidate = await makeUser('first');
    const warn = vi.fn();
    const info = vi.fn();

    try {
      await bootstrapAdmin({ info, warn }, `missing.${marker}@test.vovplan.io`);
      expect(warn).toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();

      await bootstrapAdmin({ info, warn }, candidate.email);
      const granted = await prisma.user.findUnique({ where: { id: candidate.id } });
      expect(granted?.isAdmin).toBe(true);
      expect(granted?.accountLevel).toBe(AccountLevel.MASTER_UNLIMITED);

      const logged = await prisma.adminAction.findFirst({
        where: { action: 'admin.grant', targetUserId: candidate.id },
      });
      expect(logged?.details).toMatchObject({ via: 'BOOTSTRAP_ADMIN_EMAIL' });

      const other = await makeUser('other');
      await bootstrapAdmin({ info, warn }, other.email);
      expect((await prisma.user.findUnique({ where: { id: other.id } }))?.isAdmin).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: candidate.id }, data: { isAdmin: false } });
      if (existing.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: existing.map((e) => e.id) } },
          data: { isAdmin: true },
        });
      }
    }
  });
});
