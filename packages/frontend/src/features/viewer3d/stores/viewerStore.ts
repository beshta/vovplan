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

  // ── First-person: точка «высадки» на земле ──
  fpPoint: [number, number, number] | null;
  setFpPoint: (p: [number, number, number] | null) => void;

  // ── Инструменты рисования ─────────────────
  annDrawMode: 'pin' | 'arrow' | 'line' | 'freehand';
  annColor: string;
  setAnnColor: (c: string) => void;
  annWidth: number;
  setAnnWidth: (w: number) => void;
  setAnnDrawMode: (m: 'pin' | 'arrow' | 'line' | 'freehand') => void;
  utilityDrawMode: boolean;
  setUtilityDrawMode: (v: boolean) => void;

  /** Обработчики кликов по рельефу — регистрирует активный инструмент.
      Scene рейкастит сам террейн и зовёт их с точной точкой попадания. */
  groundHandlers: {
    onClick?: (pt: [number, number, number]) => void;
    onDown?: (pt: [number, number, number]) => void;
    onMove?: (pt: [number, number, number]) => void;
    onUp?: () => void;
  } | null;
  setGroundHandlers: (h: ViewerState['groundHandlers']) => void;

  // ── Selection ─────────────────────────────
  selectedObjectId: string | null;
  selectObject: (id: string | null) => void;
  /** Выбранная инженерная сеть (для панели редактирования) */
  selectedUtilityId: string | null;
  selectUtility: (id: string | null) => void;
  /** Выбранная аннотация (для редактора) */
  selectedAnnotationId: string | null;
  selectAnnotation: (id: string | null) => void;

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
  /** Метаданные импортированного реального рельефа (текстура, размеры, высоты, периметр) */
  terrainMeta: import('../../../shared/api').TerrainMeta | null;
  setTerrainMeta: (m: import('../../../shared/api').TerrainMeta | null) => void;
  /** Показ OSM-зданий импортированного ландшафта */
  showBuildings: boolean;
  setShowBuildings: (v: boolean) => void;

  // ── Черновик рисуемой инженерной сети (общий для 3D-превью и HUD-панели) ──
  utilityDraft: {
    points: [number, number, number][];
    type: string;
    location: 'UNDERGROUND' | 'OVERHEAD';
    depth: number;
    diameter: number;
  };
  addDraftPoint: (pt: [number, number, number]) => void;
  undoDraftPoint: () => void;
  clearDraftPoints: () => void;
  setDraftField: (patch: Partial<ViewerState['utilityDraft']>) => void;
  proceduralTerrain: boolean;
  setProceduralTerrain: (v: boolean) => void;
  wireframe: boolean;
  setWireframe: (v: boolean) => void;

  // ── Model loading state ───────────────────
  loadingModels: Set<string>;
  setLoadingModel: (modelId: string, loading: boolean) => void;

  // ── Camera lock (during transform) ────────
  cameraLocked: boolean;
  setCameraLocked: (v: boolean) => void;

  // ── Camera presets (fly-to + захват позы) ──
  /** Цель плавного перелёта камеры; CameraRig анимирует и сбрасывает в null */
  cameraFlyTarget: { position: [number, number, number]; target: [number, number, number] } | null;
  flyTo: (pose: { position: [number, number, number]; target: [number, number, number] }) => void;
  clearFlyTarget: () => void;
  /** Геттер текущей позы камеры — регистрируется CameraRig'ом изнутри Canvas */
  cameraGetter: (() => { position: [number, number, number]; target: [number, number, number] }) | null;
  setCameraGetter: (fn: (() => { position: [number, number, number]; target: [number, number, number] }) | null) => void;

  // ── Undo / Redo history ───────────────────
  history: TransformHistoryEntry[];
  historyIndex: number;
  pushHistory: (entry: TransformHistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  resetTransform: (objectId: string) => void;
}

interface TransformHistoryEntry {
  objectId: string;
  oldPosition: [number, number, number];
  oldRotation: [number, number, number];
  oldScale: [number, number, number];
  newPosition: [number, number, number];
  newRotation: [number, number, number];
  newScale: [number, number, number];
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
  // Выход из first-person сбрасывает точку высадки
  setCameraView: (cameraView) =>
    set(cameraView === 'first-person' ? { cameraView } : { cameraView, fpPoint: null }),

  // First-person
  fpPoint: null,
  setFpPoint: (fpPoint) => set({ fpPoint }),

  // Инструменты рисования
  annDrawMode: 'pin',
  setAnnDrawMode: (annDrawMode) => set({ annDrawMode }),
  annColor: '#ef4444',
  setAnnColor: (annColor) => set({ annColor }),
  annWidth: 0.4,
  setAnnWidth: (annWidth) => set({ annWidth }),
  utilityDrawMode: false,
  setUtilityDrawMode: (utilityDrawMode) => set({ utilityDrawMode }),
  groundHandlers: null,
  setGroundHandlers: (groundHandlers) => set({ groundHandlers }),

  // Selection
  selectedObjectId: null,
  selectObject: (selectedObjectId) => set({ selectedObjectId }),

  selectedUtilityId: null,
  selectUtility: (selectedUtilityId) => set({ selectedUtilityId }),
  selectedAnnotationId: null,
  selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId }),

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
  terrainMeta: null,
  setTerrainMeta: (terrainMeta) => set({ terrainMeta }),
  showBuildings: true,
  setShowBuildings: (showBuildings) => set({ showBuildings }),

  utilityDraft: { points: [], type: 'WATER', location: 'UNDERGROUND', depth: 1.5, diameter: 200 },
  addDraftPoint: (pt) => set((s) => ({ utilityDraft: { ...s.utilityDraft, points: [...s.utilityDraft.points, pt] } })),
  undoDraftPoint: () => set((s) => ({ utilityDraft: { ...s.utilityDraft, points: s.utilityDraft.points.slice(0, -1) } })),
  clearDraftPoints: () => set((s) => ({ utilityDraft: { ...s.utilityDraft, points: [] } })),
  setDraftField: (patch) => set((s) => ({ utilityDraft: { ...s.utilityDraft, ...patch } })),
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

  // Camera lock
  cameraLocked: false,
  setCameraLocked: (cameraLocked) => set({ cameraLocked }),

  // Camera presets
  cameraFlyTarget: null,
  flyTo: (pose) => set({ cameraFlyTarget: pose, cameraView: 'orbit' }),
  clearFlyTarget: () => set({ cameraFlyTarget: null }),
  cameraGetter: null,
  setCameraGetter: (cameraGetter) => set({ cameraGetter }),

  // Undo / Redo history
  history: [],
  historyIndex: -1,

  pushHistory: (entry) =>
    set((s) => {
      const truncated = s.history.slice(0, s.historyIndex + 1);
      const next = [...truncated, entry];
      const capped = next.length > 50 ? next.slice(next.length - 50) : next;
      return { history: capped, historyIndex: capped.length - 1 };
    }),

  undo: () =>
    set((s) => {
      if (s.historyIndex < 0) return s;
      const entry = s.history[s.historyIndex];
      const newObjects = s.objects.map((o) =>
        o.id === entry.objectId
          ? { ...o, position: entry.oldPosition, rotation: entry.oldRotation, scale: entry.oldScale }
          : o
      );
      return { objects: newObjects, historyIndex: s.historyIndex - 1 };
    }),

  redo: () =>
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s;
      const entry = s.history[s.historyIndex + 1];
      const newObjects = s.objects.map((o) =>
        o.id === entry.objectId
          ? { ...o, position: entry.newPosition, rotation: entry.newRotation, scale: entry.newScale }
          : o
      );
      return { objects: newObjects, historyIndex: s.historyIndex + 1 };
    }),

  resetTransform: (objectId) =>
    set((s) => {
      const obj = s.objects.find((o) => o.id === objectId);
      if (!obj) return s;
      const entry: TransformHistoryEntry = {
        objectId,
        oldPosition: obj.position,
        oldRotation: obj.rotation,
        oldScale: obj.scale,
        newPosition: obj.position,        // keep position
        newRotation: [0, 0, 0],          // reset rotation
        newScale: [1, 1, 1],             // reset scale
      };
      const truncated = s.history.slice(0, s.historyIndex + 1);
      const next = [...truncated, entry];
      const capped = next.length > 50 ? next.slice(next.length - 50) : next;
      const newObjects = s.objects.map((o) =>
        o.id === objectId
          ? { ...o, rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }
          : o
      );
      return { objects: newObjects, history: capped, historyIndex: capped.length - 1 };
    }),
}));
