import { useViewerStore } from '../stores/viewerStore';
import { sceneApi } from '../../../shared/api';

/**
 * Side panel showing info about the selected object.
 *
 * Flow:
 * 1. User clicks an object (or selects from list) → panel appears
 * 2. Panel shows: name, author, position, dimensions, visibility
 * 3. If user can edit → "✏️ Изменить" button activates transform mode
 * 4. While editing → "✓ Готово" button deactivates
 *
 * Also shows soft-delete/restore controls for Master.
 */
export default function ObjectInfoPanel({ projectId }: { projectId: string }) {
  const selectedId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const selectObject = useViewerStore((s) => s.selectObject);
  const mode = useViewerStore((s) => s.mode);
  const setMode = useViewerStore((s) => s.setMode);
  const role = useViewerStore((s) => s.role);
  const updateObject = useViewerStore((s) => s.updateObject);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) return null;

  const isHidden = obj.hidden;
  const isEditing = mode === 'master-edit' || mode === 'partition-edit';
  const canEdit = role === 'MASTER' || (role === 'DESIGNER' && obj.authorId === useViewerStore.getState().role);

  const handleEditToggle = () => {
    if (isEditing) {
      // Stop editing → back to view
      setMode('view');
    } else {
      // Start editing → switch to edit mode
      setMode(role === 'MASTER' ? 'master-edit' : 'partition-edit');
    }
  };

  const handleHide = async () => {
    try {
      await sceneApi.deleteObject(projectId, obj.id);
      updateObject(obj.id, { hidden: true });
    } catch (err) {
      console.error('Failed to hide object:', err);
    }
  };

  const handleRestore = async () => {
    try {
      await sceneApi.restoreObject(projectId, obj.id);
      updateObject(obj.id, { hidden: false });
    } catch (err) {
      console.error('Failed to restore:', err);
    }
  };

  return (
    <div className="absolute right-4 top-4 w-72 bg-slate-900/95 backdrop-blur rounded-xl shadow-2xl border border-slate-700 overflow-hidden z-20">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-800 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm truncate">{obj.name}</h3>
        <button
          onClick={() => selectObject(null)}
          className="text-slate-400 hover:text-white text-lg leading-none flex-shrink-0 ml-2"
        >×</button>
      </div>

      {/* Info */}
      <div className="p-4 space-y-2.5 text-sm">
        <InfoRow label="Автор" value={obj.authorName} />

        <InfoRow
          label="Позиция"
          value={`${obj.position[0].toFixed(1)}, ${obj.position[1].toFixed(1)}, ${obj.position[2].toFixed(1)}`}
        />

        <InfoRow
          label="Поворот"
          value={`${(obj.rotation[0] * 180 / Math.PI).toFixed(0)}°, ${(obj.rotation[1] * 180 / Math.PI).toFixed(0)}°, ${(obj.rotation[2] * 180 / Math.PI).toFixed(0)}°`}
        />

        <InfoRow
          label="Масштаб"
          value={`${obj.scale[0].toFixed(2)}, ${obj.scale[1].toFixed(2)}, ${obj.scale[2].toFixed(2)}`}
        />

        <InfoRow label="Видимость" value={obj.visible ? 'Видим' : 'Скрыт'} />

        {isHidden && (
          <div className="mt-2 p-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 text-xs">
            ⚠ Объект скрыт (soft-delete). Виден только Мастеру.
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 space-y-2">
        {/* Edit / Done button */}
        {canEdit && !isHidden && (
          <button
            onClick={handleEditToggle}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isEditing
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-vovplan-600 text-white hover:bg-vovplan-700'
            }`}
          >
            {isEditing ? '✓ Готово' : '✏️ Изменить'}
          </button>
        )}

        {/* Transform mode hint */}
        {isEditing && canEdit && !isHidden && (
          <div className="text-xs text-slate-400 bg-slate-800/50 rounded-lg p-2">
            <div className="flex items-center gap-2 mb-1">
              <span>Инструменты слева:</span>
            </div>
            <div className="flex gap-2">
              <span className="px-1.5 py-0.5 bg-slate-700 rounded">↔ Двигать</span>
              <span className="px-1.5 py-0.5 bg-slate-700 rounded">↻ Вращать</span>
              <span className="px-1.5 py-0.5 bg-slate-700 rounded">⤢ Масштаб</span>
            </div>
          </div>
        )}

        {/* Soft-delete / Restore (Master only) */}
        {role === 'MASTER' && (
          isHidden ? (
            <button
              onClick={handleRestore}
              className="w-full px-4 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-600"
            >↺ Восстановить</button>
          ) : (
            <button
              onClick={handleHide}
              className="w-full px-4 py-2 bg-red-900/50 text-red-300 rounded-lg text-sm font-medium hover:bg-red-900/70"
            >🗑 Скрыть</button>
          )
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  );
}
