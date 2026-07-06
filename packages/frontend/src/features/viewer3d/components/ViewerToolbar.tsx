import { useViewerStore } from '../stores/viewerStore';

type DrawMode = 'pin' | 'arrow' | 'line' | 'freehand';

/**
 * Floating toolbar for mode switching, camera, layers.
 * MASTER sees ALL functions (edit + annotate + utilities + networks).
 */
export default function ViewerToolbar() {
  const {
    mode, setMode,
    role,
    cameraView, setCameraView,
    transformMode, setTransformMode,
    showHidden, setShowHidden,
    showAnnotations, setShowAnnotations,
    xrayMode, setXrayMode,
  } = useViewerStore();

  // Annotation sub-mode (draw type)
  const annDrawMode = useViewerStore((s) => (s as any).annDrawMode ?? 'pin');
  const setAnnDrawMode = (m: DrawMode) =>
    useViewerStore.setState({ annDrawMode: m } as any);

  // MASTER can also annotate (not just SUPER_SPECTATOR)
  const canAnnotate = role === 'MASTER' || role === 'DESIGNER' || role === 'SUPER_SPECTATOR';
  const canEdit = role === 'MASTER' || role === 'DESIGNER';

  return (
    <>
      {/* ── Left toolbar — mode + transform ── */}
      <div className="absolute left-4 top-4 flex flex-col gap-1 bg-slate-900/95 backdrop-blur rounded-xl p-1.5 shadow-2xl border border-slate-700 z-20">
        <ToolButton active={mode === 'view'} onClick={() => setMode('view')} title="Просмотр">
          👁
        </ToolButton>

        {canEdit && (
          <ToolButton
            active={mode === 'master-edit' || mode === 'partition-edit'}
            onClick={() => setMode(role === 'MASTER' ? 'master-edit' : 'partition-edit')}
            title="Редактирование"
          >✏️</ToolButton>
        )}

        {canAnnotate && (
          <ToolButton
            active={mode === 'annotate'}
            onClick={() => setMode('annotate')}
            title="Аннотации"
          >✒️</ToolButton>
        )}

        {canEdit && (
          <ToolButton
            active={!!(useViewerStore.getState() as any).utilityDrawMode}
            onClick={() => {
              const st = useViewerStore.getState() as any;
              useViewerStore.setState({ utilityDrawMode: !st.utilityDrawMode } as any);
            }}
            title="Создание инженерных сетей"
          >🔧</ToolButton>
        )}

        {/* Transform tools — visible in edit mode */}
        {(mode === 'master-edit' || mode === 'partition-edit') && (
          <>
            <div className="h-px bg-slate-700 my-1" />
            <ToolButton active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} title="Перемещение">↔</ToolButton>
            <ToolButton active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} title="Поворот">↻</ToolButton>
            <ToolButton active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} title="Масштаб">⤢</ToolButton>
          </>
        )}

        {/* Annotation draw tools — visible in annotate mode */}
        {mode === 'annotate' && (
          <>
            <div className="h-px bg-slate-700 my-1" />
            <ToolButton active={annDrawMode === 'pin'} onClick={() => setAnnDrawMode('pin')} title="Метка (pin)">📍</ToolButton>
            <ToolButton active={annDrawMode === 'arrow'} onClick={() => setAnnDrawMode('arrow')} title="Стрелка">➤</ToolButton>
            <ToolButton active={annDrawMode === 'line'} onClick={() => setAnnDrawMode('line')} title="Линия">📏</ToolButton>
            <ToolButton active={annDrawMode === 'freehand'} onClick={() => setAnnDrawMode('freehand')} title="От руки">✏️</ToolButton>
          </>
        )}
      </div>

      {/* ── Right toolbar — layers & camera ── */}
      <div className="absolute right-4 top-20 flex flex-col gap-1 bg-slate-900/95 backdrop-blur rounded-xl p-1.5 shadow-2xl border border-slate-700 z-20">
        <ToolButton
          active={cameraView === 'first-person'}
          onClick={() => setCameraView(cameraView === 'first-person' ? 'orbit' : 'first-person')}
          title="Вид от первого лица / Обзор"
        >{cameraView === 'first-person' ? '🗺️' : '🚶'}</ToolButton>

        <div className="h-px bg-slate-700 my-1" />

        {/* X-Ray toggle */}
        <ToolButton
          active={xrayMode}
          onClick={() => setXrayMode(!xrayMode)}
          title="X-Ray (просвет подземных сетей)"
        >🔧</ToolButton>

        {/* Annotations visibility */}
        <ToolButton
          active={showAnnotations}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Показать аннотации"
        >📝</ToolButton>

        {/* Show hidden (Master only) */}
        {role === 'MASTER' && (
          <ToolButton
            active={showHidden}
            onClick={() => setShowHidden(!showHidden)}
            title="Показать скрытые объекты"
          >👻</ToolButton>
        )}
      </div>
    </>
  );
}

function ToolButton({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-9 h-9 flex items-center justify-center rounded-lg text-base transition-colors ${
        active
          ? 'bg-vovplan-600 text-white'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
