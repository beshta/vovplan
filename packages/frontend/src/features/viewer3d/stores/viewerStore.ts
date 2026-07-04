import { create } from 'zustand';
import type { ViewerMode, CameraView, TransformMode, SceneObjectData, AnnotationData } from '../types';
import { ProjectRole } from '@vovplan/shared';

interface ViewerState {
  // ── Mode & role ───────────────────────────
  mode: ViewerMode;
  role: ProjectRole;
  setMode: (mode: ViewerMode) => void;
  /** Derive viewer mode from project role */
  initFromRole: (role: ProjectRole) => void;

  // ── Camera ────────────────────────────────
  cameraView: CameraView;
  setCameraView: (v: CameraView) => void;

  // ── Selection ─────────────────────────────
  selectedObjectId: string | null;
  selectObject: (id: string | null) => void;

  // ── Transform ─────────────────────────────
  transformMode: TransformMode;
  setTransformMode: (m: TransformMode) => void;

  // ── Objects ───────────────────────────────
  objects: SceneObjectData[];
  setObjects: (objs: SceneObjectData[]) => void;
  updateObject: (id: string, patch: Partial<SceneObjectData>) => void;
  addObject: (obj: SceneObjectData) => void;
  removeObject: (id: string) => void;

  // ── Annotations ───────────────────────────
  annotations: AnnotationData[];
  addAnnotation: (a: AnnotationData) => void;
  removeAnnotation: (id: string) => void;

  // ── Layer visibility ──────────────────────
  showHidden: boolean;       // Master: show soft-deleted objects
  setShowHidden: (v: boolean) => void;
  showUtilities: boolean;    // X-ray mode
  setShowUtilities: (v: boolean) => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  // Mode & role
  mode: 'view',
  role: ProjectRole.SPECTATOR,
  setMode: (mode) => set({ mode }),
  initFromRole: (role) => {
    const mode: ViewerMode =
      role === 'MASTER' ? 'master-edit' :
      role === 'DESIGNER' ? 'partition-edit' :
      role === 'SUPER_SPECTATOR' ? 'annotate' :
      'view';
    set({ role, mode });
  },

  // Camera
  cameraView: 'orbit',
  setCameraView: (cameraView) => set({ cameraView }),

  // Selection
  selectedObjectId: null,
  selectObject: (selectedObjectId) => set({ selectedObjectId }),

  // Transform
  transformMode: 'translate',
  setTransformMode: (transformMode) => set({ transformMode }),

  // Objects
  objects: [],
  setObjects: (objects) => set({ objects }),
  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),
  addObject: (obj) => set((s) => ({ objects: [...s.objects, obj] })),
  removeObject: (id) => set((s) => ({ objects: s.objects.filter((o) => o.id !== id) })),

  // Annotations
  annotations: [],
  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

  // Layers
  showHidden: false,
  setShowHidden: (showHidden) => set({ showHidden }),
  showUtilities: false,
  setShowUtilities: (showUtilities) => set({ showUtilities }),
  showAnnotations: true,
  setShowAnnotations: (showAnnotations) => set({ showAnnotations }),
}));
