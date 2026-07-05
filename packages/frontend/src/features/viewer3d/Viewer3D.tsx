import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectRole } from '@vovplan/shared';
import { useViewerStore } from './stores/viewerStore';
import { sceneApi } from '../../shared/api';
import Scene from './components/Scene';
import ViewerToolbar from './components/ViewerToolbar';
import ObjectInfoPanel from './components/ObjectInfoPanel';

interface Viewer3DProps {
  projectId: string;
  role: ProjectRole;
  userId: string;
}

/**
 * VOVPLAN 3D Viewer — main entry point.
 * Loads scene objects from real API, no more demo data.
 */
export default function Viewer3D({ projectId, role, userId }: Viewer3DProps) {
  const initFromRole = useViewerStore((s) => s.initFromRole);
  const setObjects = useViewerStore((s) => s.setObjects);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);

  useEffect(() => {
    initFromRole(role);
  }, [role, initFromRole]);

  // ── Load scene objects from API ──
  const { data: sceneData } = useQuery({
    queryKey: ['scene-objects', projectId],
    queryFn: () => sceneApi.listObjects(projectId),
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

  return (
    <div className="relative w-full h-full">
      <Scene currentUserId={userId} projectId={projectId} />

      <ViewerToolbar />
      <ObjectInfoPanel />

      {/* Empty state hint */}
      {sceneData?.data.length === 0 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-slate-400 pointer-events-none z-10">
          <div className="text-5xl mb-3">🏗️</div>
          <p className="text-sm">Сцена пуста. Объекты появятся после загрузки.</p>
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
  );
}
