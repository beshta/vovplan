import { Server as SocketServer, type Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

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

    // ── Join a project room ──
    socket.on('join', (payload: { projectId: string; name?: string }) => {
      const { projectId } = payload ?? {};
      if (!projectId || typeof projectId !== 'string') return;

      joinedProject = projectId;
      socket.join(roomOf(projectId));

      const peer: PresencePeer = {
        socketId: socket.id,
        userId: user.userId,
        name: payload.name?.slice(0, 60) || user.email,
        color: colorForUser(user.userId),
      };
      if (!presence.has(projectId)) presence.set(projectId, new Map());
      presence.get(projectId)!.set(socket.id, peer);

      // Send current peers to the newcomer, then broadcast the updated list to all
      socket.emit('presence', peersList(projectId));
      broadcastPresence(io, projectId);
    });

    // ── Live cursor (ephemeral, relayed to others) ──
    socket.on('cursor', (payload: { projectId: string; point: [number, number, number] | null }) => {
      if (!payload?.projectId) return;
      socket.to(roomOf(payload.projectId)).emit('cursor', {
        socketId: socket.id,
        userId: user.userId,
        color: colorForUser(user.userId),
        point: payload.point,
      });
    });

    // ── Live object transform during drag (ephemeral, relayed to others) ──
    socket.on(
      'object:transform',
      (payload: {
        projectId: string;
        objectId: string;
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      }) => {
        if (!payload?.projectId || !payload.objectId) return;
        socket.to(roomOf(payload.projectId)).emit('object:transform', {
          objectId: payload.objectId,
          position: payload.position,
          rotation: payload.rotation,
          scale: payload.scale,
          by: user.userId,
        });
      },
    );

    // ── Leave / disconnect: clean up presence ──
    const cleanup = () => {
      if (joinedProject) {
        presence.get(joinedProject)?.delete(socket.id);
        broadcastPresence(io, joinedProject);
        socket.to(roomOf(joinedProject)).emit('cursor', {
          socketId: socket.id,
          userId: user.userId,
          point: null,
        });
      }
    };

    socket.on('leave', cleanup);
    socket.on('disconnect', cleanup);
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
