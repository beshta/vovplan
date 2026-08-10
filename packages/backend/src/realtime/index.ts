import { Server as SocketServer, type Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import prisma from '../db/prisma.js';
import { getUserRole } from '../utils/permissions.js';

// ── Type augmentation: fastify.io for route broadcasts ──
declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer;
  }
}

interface SocketUser {
  userId: string;
  email: string;
}

interface PresencePeer {
  socketId: string;
  userId: string;
  name: string;
  color: string;
}

// projectId → (socketId → peer)
const presence = new Map<string, Map<string, PresencePeer>>();

// Deterministic color per user (stable across reconnects)
const PEER_COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PEER_COLORS[hash % PEER_COLORS.length];
}

const roomOf = (projectId: string) => `project:${projectId}`;

function peersList(projectId: string): PresencePeer[] {
  return Array.from(presence.get(projectId)?.values() ?? []);
}

function broadcastPresence(io: SocketServer, projectId: string) {
  io.to(roomOf(projectId)).emit('presence', peersList(projectId));
}

/**
 * Attach a Socket.io server to the Fastify HTTP server.
 * Handles: JWT auth handshake, per-project rooms, presence tracking,
 * live cursor + live object-transform relays.
 * Persisted mutations are broadcast from the HTTP routes via `fastify.io`.
 */
export function setupRealtime(fastify: FastifyInstance): SocketServer {
  const io = new SocketServer(fastify.server, {
    cors: {
      origin: config.cors.origins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // ── Auth: verify JWT from handshake ──
  io.use((socket, next) => {
    const token: string | undefined =
      socket.handshake.auth?.token ?? (socket.handshake.query?.token as string | undefined);
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      const payload = fastify.jwt.verify<SocketUser>(token);
      (socket.data as { user: SocketUser }).user = { userId: payload.userId, email: payload.email };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user: SocketUser }).user;
    let joinedProject: string | null = null;

    /** Выйти из текущей комнаты и убрать себя из присутствия */
    const leaveRoom = () => {
      if (!joinedProject) return;
      const left = joinedProject;
      joinedProject = null;
      presence.get(left)?.delete(socket.id);
      socket.leave(roomOf(left));
      broadcastPresence(io, left);
      // Чужой курсор должен погаснуть, а не застыть на месте
      socket.to(roomOf(left)).emit('cursor', {
        socketId: socket.id,
        userId: user.userId,
        point: null,
      });
    };

    /*
     * Вход в комнату проекта.
     *
     * Участие ОБЯЗАТЕЛЬНО проверяется здесь. Раньше проверки не было вовсе:
     * достаточно было знать чужой projectId, чтобы получать живой поток чужого
     * проекта целиком — правки объектов, комментарии, сети, рельеф, курсоры и
     * список присутствующих с почтами. HTTP-маршруты право спрашивают все до
     * одного, а сокет пускал мимо них.
     */
    socket.on('join', async (payload: { projectId: string; name?: string }) => {
      const { projectId } = payload ?? {};
      if (!projectId || typeof projectId !== 'string') return;

      const [role, me] = await Promise.all([
        getUserRole(user.userId, projectId),
        prisma.user.findUnique({
          where: { id: user.userId },
          select: { displayName: true },
        }),
      ]);

      if (!role) {
        // Не участник — молча в комнату не пускаем, но и молчать нельзя:
        // клиент должен понимать, почему не приходит присутствие
        socket.emit('join:denied', { projectId });
        return;
      }

      // Смена проекта в той же вкладке: из прошлой комнаты надо выйти,
      // иначе события двух проектов польются в одно окно
      if (joinedProject && joinedProject !== projectId) leaveRoom();

      joinedProject = projectId;
      socket.join(roomOf(projectId));

      const peer: PresencePeer = {
        socketId: socket.id,
        userId: user.userId,
        // Имя берём из базы, а не из payload: присланным именем можно было
        // представиться кем угодно. Почта в запасной вариант больше не идёт —
        // список присутствующих её раздавал всей комнате.
        name: me?.displayName || 'Участник',
        color: colorForUser(user.userId),
      };
      if (!presence.has(projectId)) presence.set(projectId, new Map());
      presence.get(projectId)!.set(socket.id, peer);

      // Send current peers to the newcomer, then broadcast the updated list to all
      socket.emit('presence', peersList(projectId));
      broadcastPresence(io, projectId);
    });

    /*
     * Пересылка эфемерных событий.
     *
     * Комната берётся из того, куда сокет реально вошёл, а НЕ из payload.
     * Пока адресат брался из присланных данных, попасть в чужую комнату можно
     * было и без join: достаточно указать чужой projectId в самом событии, и
     * чужие клиенты применяли подсунутое движение объекта у себя.
     */
    socket.on('cursor', (payload: { point: [number, number, number] | null }) => {
      if (!joinedProject) return;
      socket.to(roomOf(joinedProject)).emit('cursor', {
        socketId: socket.id,
        userId: user.userId,
        color: colorForUser(user.userId),
        point: payload?.point ?? null,
      });
    });

    // ── Live object transform during drag (ephemeral, relayed to others) ──
    socket.on(
      'object:transform',
      (payload: {
        objectId: string;
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      }) => {
        if (!joinedProject || !payload?.objectId) return;
        socket.to(roomOf(joinedProject)).emit('object:transform', {
          objectId: payload.objectId,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale,
          by: user.userId,
        });
      },
    );

    socket.on('leave', leaveRoom);
    socket.on('disconnect', leaveRoom);
  });

  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => {
    await io.close();
  });

  return io;
}

/**
 * Broadcast a persisted scene-object change to everyone in the project room.
 * `object` is the full payload for create/update, or `{ id, deleted: true }` for removal.
 */
export function emitObjectChanged(
  fastify: FastifyInstance,
  projectId: string,
  object: unknown,
) {
  fastify.io?.to(roomOf(projectId)).emit('object:changed', object);
}

/** Broadcast a persisted comment/annotation change to the project room. */
export function emitCommentChanged(
  fastify: FastifyInstance,
  projectId: string,
  comment: unknown,
) {
  fastify.io?.to(roomOf(projectId)).emit('comment:changed', comment);
}

/** Broadcast a persisted utility-network change (create/update/delete) to the project room. */
export function emitUtilityChanged(
  fastify: FastifyInstance,
  projectId: string,
  utility: unknown,
) {
  fastify.io?.to(roomOf(projectId)).emit('utility:changed', utility);
}

/** Broadcast a persisted fence change (create/update/delete) to the project room. */
export function emitFenceChanged(
  fastify: FastifyInstance,
  projectId: string,
  fence: unknown,
) {
  fastify.io?.to(roomOf(projectId)).emit('fence:changed', fence);
}

/** Broadcast a terrain change. Payload carries the new terrainUrl (null = removed). */
export function emitTerrainChanged(
  fastify: FastifyInstance,
  projectId: string,
  payload: { terrainUrl: string | null; terrainMeta?: unknown },
) {
  fastify.io?.to(roomOf(projectId)).emit('terrain:changed', payload);
}

/** Broadcast a model-library change (upload/delete) to the project room. */
export function emitModelChanged(
  fastify: FastifyInstance,
  projectId: string,
  model: unknown,
) {
  fastify.io?.to(roomOf(projectId)).emit('model:changed', model);
}
