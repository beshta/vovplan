import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, disconnectSocket } from './socket';
import { usePresenceStore, type Peer, type PeerCursor } from './presenceStore';
import { useViewerStore } from '../viewer3d/stores/viewerStore';

/**
 * Connects to the realtime server for a project and wires incoming events:
 * - presence  → active-user list
 * - cursor    → other users' 3D cursors
 * - object:transform → live ghost movement during someone else's drag
 * - object:changed   → refetch persisted scene objects (role-aware on the server)
 * - comment:changed  → refetch persisted comments/annotations
 * - utility:changed  → refetch utility networks
 * - terrain:changed  → apply new terrainUrl (or null on removal) + refetch project
 * - model:changed    → refetch the project model library
 */
export function useRealtime(projectId: string, userName: string) {
  const queryClient = useQueryClient();
  const setConnected = usePresenceStore((s) => s.setConnected);
  const setPeers = usePresenceStore((s) => s.setPeers);
  const setCursor = usePresenceStore((s) => s.setCursor);
  const reset = usePresenceStore((s) => s.reset);

  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    const join = () => {
      setConnected(true);
      socket.emit('join', { projectId, name: userName });
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setConnected(false));
    if (socket.connected) join();

    socket.on('presence', (peers: Peer[]) => setPeers(peers));

    socket.on('cursor', (c: Partial<PeerCursor> & { point: [number, number, number] | null }) => {
      setCursor({
        socketId: c.socketId!,
        userId: c.userId!,
        color: c.color,
        point: c.point,
      });
    });

    socket.on(
      'object:transform',
      (p: {
        objectId: string;
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      }) => {
        useViewerStore.getState().updateObject(p.objectId, {
          position: p.position,
          rotation: p.rotation,
          scale: p.scale,
        });
      },
    );

    socket.on('object:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['scene-objects', projectId] });
    });

    socket.on('comment:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
    });

    socket.on('utility:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['utilities', projectId] });
    });

    socket.on('terrain:changed', (p: { terrainUrl: string | null; terrainMeta?: unknown }) => {
      // Применяем напрямую (включая удаление) + подтягиваем свежий проект
      useViewerStore.getState().setTerrainUrl(p.terrainUrl);
      useViewerStore.getState().setTerrainMeta((p.terrainMeta as any) ?? null);
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    });

    socket.on('model:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['models', projectId] });
    });

    return () => {
      socket.emit('leave');
      socket.off('connect', join);
      socket.off('disconnect');
      socket.off('presence');
      socket.off('cursor');
      socket.off('object:transform');
      socket.off('object:changed');
      socket.off('comment:changed');
      socket.off('utility:changed');
      socket.off('terrain:changed');
      socket.off('model:changed');
      reset();
      disconnectSocket();
    };
  }, [projectId, userName, queryClient, setConnected, setPeers, setCursor, reset]);
}
