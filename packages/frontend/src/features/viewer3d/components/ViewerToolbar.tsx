import {
  Eye, Pencil, PenTool, Wrench, Move, RotateCw, Maximize2,
  MapPin, MoveUpRight, Minus, Brush, PersonStanding, Map as MapIcon,
  ScanEye, MessageSquareText, EyeOff,
} from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';
import { isTouchDevice } from '../utils/deviceProfiler';

const ANN_PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff'];

/**
 * Single left-side vertical toolbar.
 * All tools in one column — no separate right toolbar.
 * Иконки — lucide, единый стиль (stroke 2, размер 20).
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
  const annColor = useViewerStore((s) => s.annColor);
  const setAnnColor = useViewerStore((s) => s.setAnnColor);
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
        <ToolButton active={mode === 'view'} onClick={() => setMode('view')} title="Просмотр">
          <Eye size={20} />
        </ToolButton>

        {canEdit && (
          <ToolButton
            active={mode === 'master-edit' || mode === 'partition-edit'}
            onClick={() => setMode(role === 'MASTER' ? 'master-edit' : 'partition-edit')}
            title="Редактирование"
          ><Pencil size={20} /></ToolButton>
        )}

        {canAnnotate && (
          <ToolButton
            active={mode === 'annotate'}
            onClick={() => setMode('annotate')}
            title="Аннотации"
          ><PenTool size={20} /></ToolButton>
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
          ><Wrench size={20} /></ToolButton>
        )}

        {/* Transform tools */}
        {(mode === 'master-edit' || mode === 'partition-edit') && (
          <>
            <div className="hud-divider" />
            <ToolButton active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} title="Перемещение">
              <Move size={20} />
            </ToolButton>
            <ToolButton active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} title="Поворот">
              <RotateCw size={20} />
            </ToolButton>
            <ToolButton active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} title="Масштаб">
              <Maximize2 size={20} />
            </ToolButton>
          </>
        )}

        {/* Annotation draw tools */}
        {mode === 'annotate' && (
          <>
            <div className="hud-divider" />
            <ToolButton active={annDrawMode === 'pin'} onClick={() => setAnnDrawMode('pin')} title="Метка (pin)">
              <MapPin size={20} />
            </ToolButton>
            <ToolButton active={annDrawMode === 'arrow'} onClick={() => setAnnDrawMode('arrow')} title="Стрелка">
              <MoveUpRight size={20} />
            </ToolButton>
            <ToolButton active={annDrawMode === 'line'} onClick={() => setAnnDrawMode('line')} title="Линия">
              <Minus size={20} />
            </ToolButton>
            <ToolButton active={annDrawMode === 'freehand'} onClick={() => setAnnDrawMode('freehand')} title="От руки">
              <Brush size={20} />
            </ToolButton>
            {/* Палитра цвета для новых аннотаций */}
            <div className="grid grid-cols-3 gap-1 px-0.5 pt-1">
              {ANN_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setAnnColor(c)}
                  className={`w-2.5 h-2.5 rounded-full transition-transform ${annColor === c ? 'ring-2 ring-white scale-125' : ''}`}
                  style={{ backgroundColor: c }}
                  title={`Цвет: ${c}`}
                />
              ))}
            </div>
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
          >{cameraView === 'first-person' ? <MapIcon size={20} /> : <PersonStanding size={20} />}</ToolButton>
        )}

        <ToolButton
          active={xrayMode}
          onClick={() => setXrayMode(!xrayMode)}
          title="X-Ray (просвет подземных сетей)"
        ><ScanEye size={20} /></ToolButton>

        <ToolButton
          active={showAnnotations}
          onClick={() => setShowAnnotations(!showAnnotations)}
          title="Показать аннотации"
        ><MessageSquareText size={20} /></ToolButton>

        {role === 'MASTER' && (
          <ToolButton
            active={showHidden}
            onClick={() => setShowHidden(!showHidden)}
            title="Показать скрытые объекты"
          ><EyeOff size={20} /></ToolButton>
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
