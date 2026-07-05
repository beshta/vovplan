import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectRole } from '@vovplan/shared';
import { useViewerStore } from './stores/viewerStore';
import { sceneApi, modelsApi } from '../../shared/api';
import type { Model3DPayload } from '../../shared/api';
import Scene from './components/Scene';
import ViewerToolbar from './components/ViewerToolbar';
import ObjectInfoPanel from './components/ObjectInfoPanel';
import ModelLibrary from './components/ModelLibrary';

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
  const setModelUrls = useViewerStore((s) => s.setModelUrls);
  const addObject = useViewerStore((s) => s.addObject);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);

  useEffect(() => {
    initFromRole(role);
  }, [role, initFromRole]);

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
      })),
    );
  }, [sceneData, setObjects]);

  // ── Build modelUrls mapping (modelId → glbUrl) ──
  useEffect(() => {
    if (!modelsData?.data) return;
    const urls: Record<string, string> = {};
    for (const m of modelsData.data) {
      urls[m.id] = m.glbUrl;
    }
    setModelUrls(urls);
  }, [modelsData, setModelUrls]);

  // ── Place a model from the library onto the scene ──
  const handlePlaceObject = async (model: Model3DPayload) => {
    const newObj = await sceneApi.createObject(projectId, {
      name: model.name,
      modelId: model.id,
      position: [0, 0, 0],
    });

    // Update modelUrl mapping
    const urls = { ...useViewerStore.getState().modelUrls };
    urls[newObj.id] = model.glbUrl;
    setModelUrls(urls);

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

  return (
    <div className="flex w-full h-full">
      {/* 3D Scene area */}
      <div className="relative flex-1">
        <Scene currentUserId={userId} projectId={projectId} />

        <ViewerToolbar />
        <ObjectInfoPanel />

        {/* Empty state hint */}
        {sceneData?.data.length === 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-slate-400 pointer-events-none z-10">
            <div className="text-5xl mb-3">🏗️</div>
            <p className="text-sm">Сцена пуста. Загрузите GLB-модель справа и разместите её.</p>
          </div>
        )}

        {cameraView === 'first-person' && (
          <>
            <button
              onClick={() => setCameraView('orbit')}
              className="absolute left-1/2 bottom-8 -translate-x-1/2 px-4 py-2 bg-vovplan-600 text-white rounded-lg text-sm font-medium hover:bg-vovplan-700 shadow-xl z-30"
            >
              ↩ Назад к обзору
            </button>
            <div className="absolute left-1/2 top-8 -translate-x-1/2 px-3 py-1.5 bg-slate-900/90 text-slate-300 text-xs rounded-full z-30">
              Вид от первого лица · высота 1.7м
            </div>
          </>
        )}
      </div>

      {/* Model Library (only for editors) */}
      {canEdit && (
        <ModelLibrary projectId={projectId} onPlaceObject={handlePlaceObject} />
      )}
    </div>
  );
}
