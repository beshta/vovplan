import { useViewerStore } from '../stores/viewerStore';
import { isTouchDevice } from '../utils/deviceProfiler';

/**
 * Single left-side vertical toolbar.
 * All tools in one column — no separate right toolbar.
 *
 * Layout (top→bottom):
 * 1. View (👁)
 * 2. Edit (✏️)
 * 3. Annotate (✒️)
 * 4. Utility creator (🔧)
 * 5. ── separator ──
 * 6. Translate (↔)
 * 7. Rotate (↻)
 * 8. Scale (⤢)
 * 9. ── separator ──
 * 10. First-person (🚶)
 * 11. X-Ray (🔬)
 * 12. Annotations toggle (📝)
 * 13. Show hidden (👻)
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

  const annDrawMode = useViewerStore((s) => s.annDrawMode);
  const setAnnDrawMode = useViewerStore((s) => s.setAnnDrawMode);
  const utilityDrawMode = useViewerStore((s) => s.utilityDrawMode);
  const setUtilityDrawMode = useViewerStore((s) => s.setUtilityDrawMode);
  const selectObject = useViewerStore((s) => s.selectObject);

  const canAnnotate = role === 'MASTER' || role === 'DESIGNER' || role === 'SUPER_SPECTATOR';
  const canEdit = role === 'MASTER' || role === 'DESIGNER';

  return (
    <>
      {/* ── Single left toolbar (позицию задаёт HUD-сетка) ── */}
      <div className="glass flex flex-col gap-1 p-1.5">
        {/* Mode tools */}
        <ToolButton active={mode === 'view'} onClick={() => setMode('view')} title="Просмотр">👁</ToolButton>

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
            active={utilityDrawMode}
            onClick={() => {
              // Панель создания сети занимает правую зону — снимаем выделение,
              // чтобы инфопанель объекта не оказалась под ней
              if (!utilityDrawMode) selectObject(null);
              setUtilityDrawMode(!utilityDrawMode);
            }}
            title="Создание инженерных сетей"
          >🔧</ToolButton>
        )}

        {/* Transform tools */}
        {(mode === 'master-edit' || mode === 'partition-edit') && (
          <>
            <div className="hud-divider" />
            <ToolButton active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} title="Перемещение">↔</ToolButton>
            <ToolButton active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} title="Поворот">↻</ToolButton>
            <ToolButton active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} title="Масштаб">⤢</ToolButton>
          </>
        )}

        {/* Annotation draw tools */}
        {mode === 'annotate' && (
          <>
            <div className="hud-divider" />
            <ToolButton active={annDrawMode === 'pin'} onClick={() => setAnnDrawMode('pin')} title="Метка (pin)">📍</ToolButton>
            <ToolButton active={annDrawMode === 'arrow'} onClick={() => setAnnDrawMode('arrow')} title="Стрелка">➤</ToolButton>
            <ToolButton active={annDrawMode === 'line'} onClick={() => setAnnDrawMode('line')} title="Линия">📏</ToolButton>
            <ToolButton active={annDrawMode === 'freehand'} onClick={() => setAnnDrawMode('freehand')} title="От руки">✏️</ToolButton>
          </>
        )}

        {/* View / layer tools */}
        <div className="hud-divider" />
        {/* First-person использует PointerLock — на тач-устройствах недоступен */}
        {!isTouchDevice() && (
          <ToolButton
            active={cameraView === 'first-person'}
            onClick={() => setCameraView(cameraView === 'first-person' ? 'orbit' : 'first-person')}
            title="Вид от первого лица / Обзор"
          >{cameraView === 'first-person' ? '🗺️' : '🚶'}</ToolButton>
        )}

        <ToolButton
          active={xrayMode}
          onClick={() => setXrayMode(!xrayMode)}
          title="X-Ray (просвет подземных сетей)"
        >🔬</ToolButton>

        <ToolButton
          active={showAnnotations}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Показать аннотации"
        >📝</ToolButton>

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
      className={`tool-btn ${active ? 'tool-btn-active' : ''}`}
    >
      {children}
    </button>
  );
}
