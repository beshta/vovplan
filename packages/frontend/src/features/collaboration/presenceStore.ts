import { create } from 'zustand';

export interface Peer {
  socketId: string;
  userId: string;
  name: string;
  color: string;
}

export interface PeerCursor {
  socketId: string;
  userId: string;
  color: string;
  point: [number, number, number];
}

interface PresenceState {
  connected: boolean;
  setConnected: (v: boolean) => void;

  peers: Peer[];
  setPeers: (peers: Peer[]) => void;

  // socketId → cursor position in scene
  cursors: Record<string, PeerCursor>;
  setCursor: (c: { socketId: string; userId: string; color?: string; point: [number, number, number] | null }) => void;

  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),

  peers: [],
  setPeers: (peers) => set({ peers }),

  cursors: {},
  setCursor: ({ socketId, userId, color, point }) =>
    set((s) => {
      const next = { ...s.cursors };
      if (!point) {
        delete next[socketId];
      } else {
        next[socketId] = { socketId, userId, color: color ?? '#94a3b8', point };
      }
      return { cursors: next };
    }),

  reset: () => set({ peers: [], cursors: {}, connected: false }),
}));
