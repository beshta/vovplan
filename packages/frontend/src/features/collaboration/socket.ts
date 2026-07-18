import { io, type Socket } from 'socket.io-client';
import { getToken } from '../../shared/api';

const API_URL = import.meta.env.VITE_API_URL ?? '';

let socket: Socket | null = null;

/** Get (or lazily create) the shared Socket.io connection, authed with the JWT. */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(API_URL || '/', {
    path: '/socket.io',
    auth: { token: getToken() ?? '' },
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// ── Typed emit helpers (ephemeral, relayed to room peers) ──

export function emitCursor(projectId: string, point: [number, number, number] | null): void {
  socket?.emit('cursor', { projectId, point });
}

export function emitLiveTransform(
  projectId: string,
  objectId: string,
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number],
): void {
  socket?.emit('object:transform', { projectId, objectId, position, rotation, scale });
}
