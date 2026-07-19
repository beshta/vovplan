import { useState } from 'react';
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
        className="absolute left-4 bottom-20 z-20 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
        title="Объекты сцены"
      >
        📋 <span className="text-slate-400 text-xs">{objects.length}</span>
      </button>
    );
  }

  return (
    <div className="absolute left-4 bottom-20 z-20 w-60 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          📋 Объекты сцены ({objects.length})
        </h3>
        <button onClick={() => setCollapsed(true)} className="text-slate-400 text-xs hover:text-slate-600" title="Свернуть">▾</button>
      </div>

      {/* List */}
      <div className="max-h-64 overflow-y-auto p-2 space-y-1">
        {objects.map((obj) => {
          const isSelected = selectedObjectId === obj.id;
          return (
            <button
              key={obj.id}
              onClick={() => selectObject(obj.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                isSelected
                  ? 'bg-vovplan-100 text-vovplan-700 ring-1 ring-vovplan-200'
                  : obj.hidden
                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              {/* Icon */}
              <span className="text-sm flex-shrink-0">
                {obj.hidden ? '👻' : '📦'}
              </span>

              {/* Name + author */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{obj.name}</p>
                <p className="text-[10px] text-slate-400 truncate">
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
