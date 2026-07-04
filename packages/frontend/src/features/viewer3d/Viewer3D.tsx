import { useEffect } from 'react';
import type { ProjectRole } from '@vovplan/shared';
import { useViewerStore } from './stores/viewerStore';
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
 */
export default function Viewer3D({ role, userId }: Viewer3DProps) {
  const initFromRole = useViewerStore((s) => s.initFromRole);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);

  useEffect(() => {
    initFromRole(role);
  }, [role, initFromRole]);

  // ── Demo data: a few placeholder objects ──
  useEffect(() => {
    const { setObjects } = useViewerStore.getState();
    setObjects([
      {
        id: 'demo-1', modelId: 'm1', name: 'Главная сцена',
        authorId: userId, authorName: 'Вы',
        position: [0, 0, -10], rotation: [0, 0, 0], scale: [1, 1, 1],
        visible: true, hidden: false,
      },
      {
        id: 'demo-2', modelId: 'm2', name: 'Бытовка',
        authorId: 'other', authorName: 'Иван П.',
        position: [15, 0, 5], rotation: [0, 0, 0], scale: [1, 1, 1],
        visible: true, hidden: false,
      },
      {
        id: 'demo-3', modelId: 'm3', name: 'Забор (скрыт)',
        authorId: 'other', authorName: 'Иван П.',
        position: [-15, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1],
        visible: true, hidden: true, hiddenBy: 'other',
      },
    ]);
  }, [userId]);

  return (
    <div className="relative w-full h-full">
      <Scene currentUserId={userId} />

      <ViewerToolbar />
      <ObjectInfoPanel />

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
