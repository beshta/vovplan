import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { Errors } from '../../utils/errors.js';

/**
 * Аналитика воронки: от захода на лендинг до импорта местности.
 *
 * Собирается в собственную базу, а не через внешний сервис: на VPS мало места
 * под ещё один контейнер, а данные о пользователях лучше не отдавать наружу.
 *
 * Персональных данных не пишем: ни IP, ни cookie. Только анонимный
 * идентификатор вкладки (sessionStorage) — он нужен, чтобы считать воронку по
 * людям, а не по кликам, и исчезает вместе с вкладкой.
 */

/** Разрешённые события — чужие названия молча игнорируем, чтобы не засорять базу */
const EVENTS = [
  'landing.view',
  'register.start',
  'register.done',
  'login.done',
  'project.create',
  'terrain.import',
  'object.place',
] as const;

const eventSchema = z.object({
  name: z.enum(EVENTS),
  anonId: z.string().min(8).max(64),
  path: z.string().max(200).optional(),
  referrer: z.string().max(300).optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Порядок шагов воронки для отчёта */
const FUNNEL: { name: (typeof EVENTS)[number]; label: string }[] = [
  { name: 'landing.view', label: 'Зашли на сайт' },
  { name: 'register.start', label: 'Начали регистрацию' },
  { name: 'register.done', label: 'Зарегистрировались' },
  { name: 'project.create', label: 'Создали проект' },
  { name: 'terrain.import', label: 'Импортировали местность' },
  { name: 'object.place', label: 'Разместили объект' },
];

export default async function analyticsRoutes(fastify: FastifyInstance) {
  // ── POST /api/analytics/event — приём события (без авторизации) ──
  // Лендинг смотрят гости, поэтому эндпоинт открытый. Ограничитель нужен,
  // чтобы им нельзя было забить базу.
  fastify.post('/event', async (request, reply) => {
    rateLimit(request, 'analytics', 60, 60_000);

    const parsed = eventSchema.safeParse(request.body);
    // Молча принимаем: сбой аналитики не должен ничего ломать у пользователя
    if (!parsed.success) return reply.code(204).send();

    const { name, anonId, path, referrer, meta } = parsed.data;

    // userId берём из токена, если он есть, но авторизацию не требуем
    let userId: string | null = null;
    try {
      const decoded = await request.jwtVerify<{ userId: string }>();
      userId = decoded.userId;
    } catch {
      /* гость — это нормально */
    }

    await prisma.analyticsEvent.create({
      data: { name, anonId, path, referrer, userId, meta: (meta ?? undefined) as never },
    });

    return reply.code(204).send();
  });

  // ── GET /api/analytics/funnel — сводка (только владельцам продукта) ──
  fastify.get('/funnel', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const me = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { isAdmin: true },
    });
    if (!me?.isAdmin) {
      Errors.Forbidden('Сводка доступна только владельцам продукта');
    }

    const { days = '30' } = request.query as { days?: string };
    const since = new Date(Date.now() - Math.min(Number(days) || 30, 365) * 86_400_000);

    // Считаем уникальных людей на каждом шаге, а не события: иначе один
    // человек, обновивший лендинг десять раз, исказил бы всю воронку
    const rows = await prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { name: true, anonId: true },
    });

    const uniq = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!uniq.has(r.name)) uniq.set(r.name, new Set());
      uniq.get(r.name)!.add(r.anonId);
    }

    const first = uniq.get(FUNNEL[0].name)?.size ?? 0;
    const steps = FUNNEL.map((s, i) => {
      const count = uniq.get(s.name)?.size ?? 0;
      const prev = i === 0 ? count : (uniq.get(FUNNEL[i - 1].name)?.size ?? 0);
      return {
        name: s.name,
        label: s.label,
        count,
        /** доля от самого первого шага */
        ofTotal: first ? Math.round((count / first) * 1000) / 10 : 0,
        /** доля от предыдущего шага — где именно теряются люди */
        ofPrev: prev ? Math.round((count / prev) * 1000) / 10 : 0,
      };
    });

    return reply.send({ since: since.toISOString(), days: Number(days) || 30, steps });
  });
}
