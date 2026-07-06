import { create } from 'zustand';
import type { ViewerMode, CameraView, TransformMode, SceneObjectData, AnnotationData, UtilityNetworkData } from '../types';
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

  // ── Annotations ─────────────────────────────
  annotations: AnnotationData[];
  addAnnotation: (a: AnnotationData) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, patch: Partial<AnnotationData>) => void;
  setAnnotations: (a: AnnotationData[]) => void;

  // ── Layer visibility ──────────────────────
  showHidden: boolean;       // Master: show soft-deleted objects
  setShowHidden: (v: boolean) => void;
  showUtilities: boolean;    // X-ray mode
  setShowUtilities: (v: boolean) => void;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;

  // ── Model URLs (modelId → glbUrl) ──────────
  modelUrls: Record<string, string>;
  setModelUrls: (urls: Record<string, string>) => void;

  // ── Model cache (modelId → {glbUrl, lod1Url, lod2Url}) ──
  modelCache: Record<string, { glbUrl: string; lod1Url: string | null; lod2Url: string | null }>;
  setModelCache: (cache: Record<string, { glbUrl: string; lod1Url: string | null; lod2Url: string | null }>) => void;

  // ── Utility networks (инженерные сети) ─────
  utilities: UtilityNetworkData[];
  setUtilities: (u: UtilityNetworkData[]) => void;

  // ── X-Ray mode ─────────────────────────────
  xrayMode: boolean;
  setXrayMode: (v: boolean) => void;

  // ── Utility type visibility ────────────────
  visibleUtilityTypes: Record<string, boolean>;
  toggleUtilityType: (type: string) => void;

  // ── Terrain ────────────────────────────────
  terrainUrl: string | null;
  setTerrainUrl: (url: string | null) => void;
  proceduralTerrain: boolean;
  setProceduralTerrain: (v: boolean) => void;
  wireframe: boolean;
  setWireframe: (v: boolean) => void;

  // ── Model loading state ───────────────────
  loadingModels: Set<string>;
  setLoadingModel: (modelId: string, loading: boolean) => void;
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
  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  setAnnotations: (annotations) => set({ annotations }),

  // Layers
  showHidden: false,
  setShowHidden: (showHidden) => set({ showHidden }),
  showUtilities: false,
  setShowUtilities: (showUtilities) => set({ showUtilities }),
  showAnnotations: true,
  setShowAnnotations: (showAnnotations) => set({ showAnnotations }),

  // Model URLs
  modelUrls: {},
  setModelUrls: (modelUrls) => set({ modelUrls }),

  // Model cache (with LOD)
  modelCache: {},
  setModelCache: (modelCache) => set({ modelCache }),

  // Utility networks
  utilities: [],
  setUtilities: (utilities) => set({ utilities }),

  // X-Ray mode
  xrayMode: false,
  setXrayMode: (xrayMode) => set({ xrayMode }),

  // Utility type visibility (all visible by default)
  visibleUtilityTypes: {
    WATER: true,
    GAS: true,
    ELECTRIC: true,
    SEWAGE: true,
    TELECOM: true,
    HEAT: true,
  },
  toggleUtilityType: (type) =>
    set((s) => ({
      visibleUtilityTypes: {
        ...s.visibleUtilityTypes,
        [type]: !s.visibleUtilityTypes[type],
      },
    })),

  // Terrain
  terrainUrl: null,
  setTerrainUrl: (terrainUrl) => set({ terrainUrl }),
  proceduralTerrain: true,
  setProceduralTerrain: (proceduralTerrain) => set({ proceduralTerrain }),
  wireframe: false,
  setWireframe: (wireframe) => set({ wireframe }),

  // Model loading state
  loadingModels: new Set<string>(),
  setLoadingModel: (modelId, loading) =>
    set((s) => {
      const next = new Set(s.loadingModels);
      if (loading) next.add(modelId);
      else next.delete(modelId);
      return { loadingModels: next };
    }),
}));
