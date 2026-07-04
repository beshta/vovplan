import { useViewerStore } from '../stores/viewerStore';

/**
 * Floating toolbar for mode switching, camera, layers.
 * Adapts to the user's role — only shows buttons they can use.
 */
export default function ViewerToolbar() {
  const {
    mode, setMode,
    role,
    cameraView, setCameraView,
    transformMode, setTransformMode,
    showHidden, setShowHidden,
    showUtilities, setShowUtilities,
    showAnnotations, setShowAnnotations,
  } = useViewerStore();

  return (
    <>
      {/* Left toolbar — mode + transform tools */}
      <div className="absolute left-4 top-4 flex flex-col gap-1 bg-slate-900/95 backdrop-blur rounded-xl p-1.5 shadow-2xl border border-slate-700 z-20">
        {/* Mode switcher (display only — derived from role) */}
        <ToolButton
          active={mode === 'view'}
          onClick={() => setMode('view')}
          title="Просмотр"
        >
          👁
        </ToolButton>

        {(role === 'MASTER' || role === 'DESIGNER') && (
          <ToolButton
            active={mode === 'master-edit' || mode === 'partition-edit'}
            onClick={() => setMode(role === 'MASTER' ? 'master-edit' : 'partition-edit')}
            title="Редактирование"
          >
            ✏️
          </ToolButton>
        )}

        {role === 'SUPER_SPECTATOR' && (
          <ToolButton
            active={mode === 'annotate'}
            onClick={() => setMode('annotate')}
            title="Аннотации"
          >
            ✒️
          </ToolButton>
        )}

        {/* Divider */}
        {(mode === 'master-edit' || mode === 'partition-edit') && (
          <>
            <div className="h-px bg-slate-700 my-1" />
            <ToolButton
              active={transformMode === 'translate'}
              onClick={() => setTransformMode('translate')}
              title="Перемещение"
            >
              ↔
            </ToolButton>
            <ToolButton
              active={transformMode === 'rotate'}
              onClick={() => setTransformMode('rotate')}
              title="Поворот"
            >
              ↻
            </ToolButton>
            <ToolButton
              active={transformMode === 'scale'}
              onClick={() => setTransformMode('scale')}
              title="Масштаб"
            >
              ⤢
            </ToolButton>
          </>
        )}
      </div>

      {/* Right toolbar — layers & camera */}
      <div className="absolute right-4 bottom-4 flex flex-col gap-1 bg-slate-900/95 backdrop-blur rounded-xl p-1.5 shadow-2xl border border-slate-700 z-20">
        {/* Camera toggle */}
        <ToolButton
          active={cameraView === 'first-person'}
          onClick={() => setCameraView(cameraView === 'first-person' ? 'orbit' : 'first-person')}
          title="Вид от первого лица / Обзор"
        >
          {cameraView === 'first-person' ? '🗺️' : '🚶'}
        </ToolButton>

        <div className="h-px bg-slate-700 my-1" />

        {/* X-ray / Utilities */}
        {(role === 'MASTER' || role === 'DESIGNER' || role === 'SUPER_SPECTATOR') && (
          <ToolButton
            active={showUtilities}
            onClick={() => setShowUtilities(!showUtilities)}
            title="Инженерные сети (просвет)"
          >
            🔧
          </ToolButton>
        )}

        {/* Annotations toggle */}
        <ToolButton
          active={showAnnotations}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Аннотации"
        >
          📝
        </ToolButton>

        {/* Show hidden (Master only) */}
        {role === 'MASTER' && (
          <ToolButton
            active={showHidden}
            onClick={() => setShowHidden(!showHidden)}
            title="Показать скрытые объекты"
          >
            👻
          </ToolButton>
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
