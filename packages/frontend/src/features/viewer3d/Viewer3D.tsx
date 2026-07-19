import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectRole } from '@vovplan/shared';
import { useViewerStore } from './stores/viewerStore';
import { sceneApi, modelsApi, utilitiesApi, projectsApi, commentsApi } from '../../shared/api';
import type { Model3DPayload, UtilityNetworkPayload, CommentPayload } from '../../shared/api';
import Scene from './components/Scene';
import ViewerToolbar from './components/ViewerToolbar';
import ObjectInfoPanel from './components/ObjectInfoPanel';
import ModelLibrary from './components/ModelLibrary';
import NavigationHelp from './components/NavigationHelp';
import UtilityLayersPanel from './components/UtilityLayersPanel';
import TerrainPanel from './components/TerrainPanel';
import AnnotationsList from './components/AnnotationsList';
import PresetsBar from './components/PresetsBar';
import SceneObjectsList from './components/SceneObjectsList';
import PresenceBar from '../collaboration/PresenceBar';
import { useRealtime } from '../collaboration/useRealtime';
import { useAuthStore } from '../../shared/authStore';
import { useIsMobile } from '../../shared/useIsMobile';

interface Viewer3DProps {
  projectId: string;
  role: ProjectRole;
  userId: string;
}

/**
 * VOVPLAN 3D Viewer — main entry point.
 * Loads scene objects and model library from real API.
 */
export default function Viewer3D({ projectId, role, userId }: Viewer3DProps) {
  const initFromRole = useViewerStore((s) => s.initFromRole);
  const setObjects = useViewerStore((s) => s.setObjects);
  const setModelCache = useViewerStore((s) => s.setModelCache);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const setAnnotations = useViewerStore((s) => s.setAnnotations);
  const addObject = useViewerStore((s) => s.addObject);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);
  const fpPoint = useViewerStore((s) => s.fpPoint);

  const userName = useAuthStore((s) => s.user?.displayName ?? s.user?.email ?? 'Гость');

  useEffect(() => {
    initFromRole(role);
  }, [role, initFromRole]);

  // ── Real-time collaboration ──
  useRealtime(projectId, userName);

  // ── Load scene objects ──
  const { data: sceneData } = useQuery({
    queryKey: ['scene-objects', projectId],
    queryFn: () => sceneApi.listObjects(projectId),
    enabled: !!projectId,
  });

  // ── Load models (for modelUrls mapping) ──
  const { data: modelsData } = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => modelsApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Load utility networks ──
  const { data: utilitiesData } = useQuery({
    queryKey: ['utilities', projectId],
    queryFn: () => utilitiesApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Load project details (for terrainUrl) ──
  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  });

  // ── Load comments / annotations ──
  const { data: commentsData } = useQuery({
    queryKey: ['comments', projectId],
    queryFn: () => commentsApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Sync API data → viewer store ──
  useEffect(() => {
    if (!sceneData?.data) return;
    setObjects(
      sceneData.data.map((o) => ({
        id: o.id,
        modelId: o.modelId,
        name: o.name,
        authorId: o.authorId,
        authorName: o.authorName,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        visible: o.visible,
        hidden: o.hidden,
        description: o.description,
        docUrl: o.docUrl,
        createdAt: o.createdAt,
        locked: o.locked,
      })),
    );
  }, [sceneData, setObjects]);

  // ── Build modelCache (modelId → {glbUrl, lod1Url, lod2Url}) ──
  useEffect(() => {
    if (!modelsData?.data) return;
    const cache: Record<string, { glbUrl: string; lod1Url: string | null; lod2Url: string | null }> = {};
    for (const m of modelsData.data) {
      cache[m.id] = {
        glbUrl: m.glbUrl,
        lod1Url: m.lod1Url,
        lod2Url: m.lod2Url,
      };
    }
    setModelCache(cache);
  }, [modelsData, setModelCache]);

  // ── Sync utilities → viewer store ──
  useEffect(() => {
    if (!utilitiesData?.data) return;
    setUtilities(
      utilitiesData.data.map((u: UtilityNetworkPayload) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        location: u.location,
        geometry: u.geometry,
        depth: u.depth,
        diameter: u.diameter,
        material: u.material,
        color: u.color,
      })),
    );
  }, [utilitiesData, setUtilities]);

  // ── Sync terrainUrl → viewer store ──
  useEffect(() => {
    if (projectData?.terrainUrl) {
      setTerrainUrl(projectData.terrainUrl);
    }
  }, [projectData, setTerrainUrl]);

  // ── Sync comments → annotations store ──
  useEffect(() => {
    if (!commentsData?.data) return;
    const annotations = commentsData.data
      .filter((c: CommentPayload) => c.type && c.geometry)
      .map((c: CommentPayload) => ({
        id: c.id,
        type: c.type as 'arrow' | 'line' | 'freehand' | 'pin',
        points: c.geometry as [number, number, number][],
        color: c.color ?? '#f59e0b',
        text: c.text,
        authorId: c.authorId,
        authorName: c.authorName,
        resolved: c.resolved,
        createdAt: c.createdAt,
      }));
    setAnnotations(annotations);
  }, [commentsData, setAnnotations]);

  // ── Place a model from the library onto the scene ──
  const handlePlaceObject = async (model: Model3DPayload) => {
    const newObj = await sceneApi.createObject(projectId, {
      name: model.name,
      modelId: model.id,
      position: [0, 0, 0],
    });

    // Update model cache with new model's LOD URLs
    const cache = { ...useViewerStore.getState().modelCache };
    cache[model.id] = {
      glbUrl: model.glbUrl,
      lod1Url: model.lod1Url,
      lod2Url: model.lod2Url,
    };
    setModelCache(cache);

    addObject({
      id: newObj.id,
      modelId: model.id,
      name: newObj.name,
      authorId: newObj.authorId,
      authorName: newObj.authorName,
      position: newObj.position,
      rotation: newObj.rotation,
      scale: newObj.scale,
      visible: true,
      hidden: false,
    });
  };

  const canEdit = role === 'MASTER' || role === 'DESIGNER';
  const isMobile = useIsMobile();
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <div className="flex w-full h-full">
      {/* 3D Scene area */}
      <div className="relative flex-1 min-w-0">
        <Scene currentUserId={userId} projectId={projectId} />

        {/* ═══ HUD: жёсткая сетка зон — панели в flex-колонках,
            перекрытия физически невозможны ═══ */}
        <div className="absolute inset-0 z-20 pointer-events-none p-3 flex gap-3">
          {/* ── Левая зона: тулбар + стек панелей ── */}
          <div className="flex gap-2 h-full min-h-0">
            <div className="pointer-events-auto self-start">
              <ViewerToolbar />
            </div>
            <div className="flex flex-col gap-2 min-h-0 w-56">
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 items-start pr-0.5">
                <UtilityLayersPanel />
                {canEdit && <TerrainPanel projectId={projectId} />}
                <SceneObjectsList />
              </div>
              <div className="pointer-events-auto self-start">
                <NavigationHelp />
              </div>
            </div>
          </div>

          {/* ── Центр: подсказки сверху, пресеты снизу ── */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-between py-1">
            <div className="pointer-events-auto">
              {cameraView === 'first-person' && (
                <div className="glass-chip text-xs whitespace-nowrap">
                  {fpPoint
                    ? '🚶 Мышь — осмотр · WASD — ходьба · ESC — курсор'
                    : '👣 Кликните точку на земле, куда «спуститься»'}
                </div>
              )}
            </div>

            {/* Empty state */}
            {sceneData?.data.length === 0 && (
              <div className="text-center text-slate-400 select-none">
                <div className="text-5xl mb-3">🏗️</div>
                <p className="text-sm">Сцена пуста. Загрузите GLB-модель справа и разместите её.</p>
              </div>
            )}

            <div className="pointer-events-auto flex flex-col items-center gap-2">
              {cameraView === 'first-person' ? (
                <button onClick={() => setCameraView('orbit')} className="btn-primary text-sm shadow-xl">
                  ↩ Назад к обзору
                </button>
              ) : (
                <PresetsBar projectId={projectId} canEdit={canEdit} />
              )}
            </div>
          </div>

          {/* ── Правая зона: присутствие, инфопанель, аннотации ── */}
          <div className="flex flex-col items-end gap-2 h-full min-h-0 w-fit">
            <div className="pointer-events-auto">
              <PresenceBar currentUserId={userId} />
            </div>
            {canEdit && isMobile && (
              <button
                onClick={() => setLibraryOpen(true)}
                className="pointer-events-auto w-11 h-11 rounded-full bg-vovplan-600 text-white text-xl shadow-xl flex items-center justify-center"
                title="Библиотека моделей"
              >
                📦
              </button>
            )}
            <div className="pointer-events-auto flex-1 min-h-0 overflow-y-auto flex flex-col items-end gap-2">
              <ObjectInfoPanel projectId={projectId} />
            </div>
            <div className="pointer-events-auto">
              <AnnotationsList projectId={projectId} />
            </div>
          </div>
        </div>

        {/* Мобильный оверлей библиотеки моделей */}
        {canEdit && isMobile && libraryOpen && (
          <div className="absolute inset-0 z-40 flex">
            <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setLibraryOpen(false)} />
            <div className="relative h-full">
              <button
                onClick={() => setLibraryOpen(false)}
                className="absolute -left-3 top-3 z-50 w-7 h-7 rounded-full bg-slate-800 text-white text-sm shadow-lg border border-white/10"
                title="Закрыть"
              >
                ✕
              </button>
              <ModelLibrary projectId={projectId} onPlaceObject={(m) => { setLibraryOpen(false); return handlePlaceObject(m); }} />
            </div>
          </div>
        )}
      </div>

      {/* Model Library (only for editors) — десктоп: постоянный сайдбар */}
      {canEdit && !isMobile && (
        <ModelLibrary projectId={projectId} onPlaceObject={handlePlaceObject} />
      )}
    </div>
  );
}
