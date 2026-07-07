import { useViewerStore } from '../stores/viewerStore';

/**
 * Scene Objects list — shows all placed objects in the current project.
 * Click an object to select it in the 3D scene.
 *
 * Panel sits on the right side, below the Model Library.
 */
export default function SceneObjectsList() {
  const objects = useViewerStore((s) => s.objects);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const selectObject = useViewerStore((s) => s.selectObject);

  if (objects.length === 0) return null;

  return (
    <div className="border-t border-slate-200">
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          📋 Объекты сцены ({objects.length})
        </h3>
      </div>

      {/* List */}
      <div className="max-h-48 overflow-y-auto p-2 space-y-1">
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
