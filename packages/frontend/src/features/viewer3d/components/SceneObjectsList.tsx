import { useState } from 'react';
import { Boxes, Box, EyeOff } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Scene Objects list — все размещённые объекты проекта.
 * Самостоятельная плавающая панель (доступна всем ролям, не только
 * редакторам с библиотекой моделей). Клик — выбор объекта в сцене.
 */
export default function SceneObjectsList() {
  const objects = useViewerStore((s) => s.objects);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const selectObject = useViewerStore((s) => s.selectObject);
  const [collapsed, setCollapsed] = useState(true);

  if (objects.length === 0) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="glass-chip pointer-events-auto"
        title="Объекты сцены"
      >
        <Boxes size={16} /> <span className="text-slate-500 text-xs">{objects.length}</span>
      </button>
    );
  }

  return (
    <div className="glass pointer-events-auto w-52 shrink-0 overflow-hidden flex flex-col max-h-72">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between shrink-0">
        <h3 className="hud-title flex items-center gap-1.5"><Boxes size={14} /> Объекты · {objects.length}</h3>
        <button onClick={() => setCollapsed(true)} className="text-slate-500 text-xs hover:text-white transition-colors" title="Свернуть">▾</button>
      </div>

      {/* List */}
      <div className="overflow-y-auto p-1.5 space-y-0.5">
        {objects.map((obj) => {
          const isSelected = selectedObjectId === obj.id;
          return (
            <button
              key={obj.id}
              onClick={() => selectObject(obj.id)}
              className={`hud-row ${
                isSelected
                  ? 'hud-row-active'
                  : obj.hidden
                    ? 'text-amber-300/80'
                    : 'text-slate-300'
              }`}
            >
              {/* Icon: скрытый объект — перечёркнутый глаз, обычный — куб */}
              <span className="flex-shrink-0 text-slate-500">
                {obj.hidden ? <EyeOff size={16} className="text-amber-400/80" /> : <Box size={16} />}
              </span>

              {/* Name + author */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{obj.name}</p>
                <p className="text-[10px] text-slate-500 truncate">
                  {obj.authorName}
                  {obj.hidden && ' · скрыт'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
