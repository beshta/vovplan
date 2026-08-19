import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import prisma from '../db/prisma.js';

// Augment Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Обесценить все токены пользователя: выход отовсюду, бан, смена пароля */
    revokeTokens: (userId: string) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; email: string; ver: number };
    user: { userId: string; email: string; ver: number };
  }
}

const unauthorized = (reply: FastifyReply) =>
  reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Требуется авторизация', statusCode: 401 });

/**
 * Ответ заблокированному.
 *
 * Не 401 и не молчаливый отказ: человек обязан понять, что происходит, иначе
 * он будет чинить пароль, писать в поддержку и злиться на «поломанный сайт».
 * Причина показывается ему целиком — её пишет администратор, зная, что она
 * будет прочитана вслух.
 */
const banned = (reply: FastifyReply, reason: string | null) =>
  reply.code(403).send({
    error: 'ACCOUNT_BANNED',
    message: reason
      ? `Учётная запись заблокирована. Причина: ${reason}`
      : 'Учётная запись заблокирована',
    statusCode: 403,
  });

// fp() обязателен: без него декораторы остались бы внутри плагина и не
// достались бы маршрутам — авторизация просто перестала бы существовать
export default fp(async function authPlugin(fastify: FastifyInstance) {
  // Register JWT
  await fastify.register(import('@fastify/jwt'), {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
  });

  /**
   * Проверка токена.
   *
   * Подписи мало. JWT отозвать нельзя — он действителен до своего срока, а срок
   * здесь неделя. Значит смена пароля не выгоняла угонщика, удалённый
   * пользователь продолжал ходить с прежним токеном, а будущая кнопка бана
   * была бы декоративной: забаненный работал бы ещё неделю.
   *
   * Поэтому у каждого пользователя есть поколение токенов, и оно сверяется с
   * базой на КАЖДОМ запросе. Это лишнее чтение по первичному ключу — на один
   * контейнер и нынешнюю нагрузку цена невелика, а «бан срабатывает сразу и
   * наверняка» дороже этой экономии. Понадобится ускорение — здесь появится
   * кэш с коротким сроком жизни, и это будет осознанный размен: бан начнёт
   * запаздывать на время жизни кэша.
   */
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return unauthorized(reply);
    }

    const account = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { tokenVersion: true, bannedAt: true, banReason: true },
    });

    // Пользователя удалили — токен обязан перестать работать вместе с ним
    if (!account) return unauthorized(reply);

    /*
     * Блокировка проверяется здесь, а не только на входе, и ДО поколения.
     *
     * Проверять её вообще нужно потому, что полагаться на одно поднятие
     * поколения нельзя: оно может не подняться из-за сбоя посреди операции, а
     * «забанен, но работает» — худший из возможных исходов.
     *
     * А раньше поколения — потому что бан его поднимает, и при обратном
     * порядке заблокированный получал бы безликое «требуется авторизация».
     * Человек шёл бы чинить пароль вместо того, чтобы прочитать причину.
     */
    if (account.bannedAt) return banned(reply, account.banReason);

    // Токены прежнего поколения: пароль сменили или отозвали сессии
    if (account.tokenVersion !== request.user.ver) return unauthorized(reply);
  });

  fastify.decorate('revokeTokens', async (userId: string) => {
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});
