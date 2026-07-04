import { useViewerStore } from '../stores/viewerStore';

/**
 * Side panel showing info about the selected object.
 * Visible in all modes when an object is selected.
 */
export default function ObjectInfoPanel() {
  const selectedId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const selectObject = useViewerStore((s) => s.selectObject);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) return null;

  const isHidden = obj.hidden;

  return (
    <div className="absolute right-4 top-4 w-72 bg-slate-900/95 backdrop-blur rounded-xl shadow-2xl border border-slate-700 overflow-hidden z-20">
      <div className="px-4 py-3 bg-slate-800 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">{obj.name}</h3>
        <button
          onClick={() => selectObject(null)}
          className="text-slate-400 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="p-4 space-y-3 text-sm">
        <InfoRow label="Автор" value={obj.authorName} />

        {obj.bbox && (
          <InfoRow
            label="Габариты"
            value={`${(obj.bbox.max[0] - obj.bbox.min[0]).toFixed(1)} × ${(obj.bbox.max[1] - obj.bbox.min[1]).toFixed(1)} × ${(obj.bbox.max[2] - obj.bbox.min[2]).toFixed(1)} м`}
          />
        )}

        <InfoRow
          label="Позиция"
          value={`${obj.position[0].toFixed(1)}, ${obj.position[1].toFixed(1)}, ${obj.position[2].toFixed(1)}`}
        />

        <InfoRow label="Видимость" value={obj.visible ? 'Видим' : 'Скрыт'} />

        {isHidden && (
          <div className="mt-2 p-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 text-xs">
            ⚠ Объект скрыт (soft-delete). Виден только Мастеру.
          </div>
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
