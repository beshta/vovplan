import { Wrench, Undo2, Trash2, Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useViewerStore } from '../stores/viewerStore';
import { utilitiesApi } from '../../../shared/api';
import type { UtilityType } from '../../../shared/api';

const UTILITY_COLORS: Record<string, string> = {
  WATER: '#2563eb', GAS: '#f59e0b', ELECTRIC: '#dc2626',
  SEWAGE: '#7c3aed', TELECOM: '#10b981', HEAT: '#ea580c',
};
const TYPES: { v: UtilityType; l: string }[] = [
  { v: 'WATER', l: 'Вода' }, { v: 'GAS', l: 'Газ' }, { v: 'ELECTRIC', l: 'Эл-во' },
  { v: 'SEWAGE', l: 'Канал.' }, { v: 'TELECOM', l: 'Связь' }, { v: 'HEAT', l: 'Тепло' },
];

/**
 * HUD-панель управления рисованием инженерной сети (вне Canvas — кнопки
 * всегда кликабельны). Тип/расположение/глубина/диаметр + создать/отмена.
 * 3D-превью и приём кликов — в UtilityCreator.
 */
export default function UtilityDrawPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const draft = useViewerStore((s) => s.utilityDraft);
  const setDraftField = useViewerStore((s) => s.setDraftField);
  const undoDraftPoint = useViewerStore((s) => s.undoDraftPoint);
  const clearDraftPoints = useViewerStore((s) => s.clearDraftPoints);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setUtilityDrawMode = useViewerStore((s) => s.setUtilityDrawMode);

  const totalLength = draft.points.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    const p = draft.points[i - 1];
    return sum + Math.sqrt((pt[0] - p[0]) ** 2 + (pt[1] - p[1]) ** 2 + (pt[2] - p[2]) ** 2);
  }, 0);

  const handleCreate = async () => {
    if (draft.points.length < 2) return;
    try {
      await utilitiesApi.create(projectId, {
        name: `${draft.type} ${new Date().toLocaleTimeString('ru-RU')}`,
        type: draft.type as UtilityType,
        location: draft.location,
        geometry: draft.points,
        depth: draft.location === 'UNDERGROUND' ? draft.depth : undefined,
        diameter: draft.diameter,
        material: 'steel',
        color: UTILITY_COLORS[draft.type],
      });
      const updated = await utilitiesApi.list(projectId);
      setUtilities(updated.data.map((u) => ({
        id: u.id, name: u.name, type: u.type, location: u.location,
        geometry: u.geometry, depth: u.depth, diameter: u.diameter,
        material: u.material, color: u.color,
      })));
      clearDraftPoints();
      queryClient.invalidateQueries({ queryKey: ['utilities', projectId] });
    } catch (err) {
      console.error('Не удалось создать сеть:', err);
    }
  };

  const close = () => { clearDraftPoints(); setUtilityDrawMode(false); };

  return (
    <div className="glass w-64 pointer-events-auto p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="hud-title flex items-center gap-1.5"><Wrench size={14} /> Рисование сети</span>
        <button onClick={close} className="text-slate-500 hover:text-white transition-colors" title="Закрыть режим"><X size={15} /></button>
      </div>

      {/* Тип */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {TYPES.map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setDraftField({ type: v })}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
              draft.type === v ? 'text-white ring-2 ring-white/40' : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
            style={draft.type === v ? { backgroundColor: UTILITY_COLORS[v] } : {}}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Расположение */}
      <div className="flex gap-1 mb-2">
        {(['UNDERGROUND', 'OVERHEAD'] as const).map((loc) => (
          <button
            key={loc}
            onClick={() => setDraftField({ location: loc })}
            className={`flex-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              draft.location === loc ? 'bg-vovplan-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {loc === 'UNDERGROUND' ? 'Подземная' : 'Надземная'}
          </button>
        ))}
      </div>

      {/* Глубина */}
      {draft.location === 'UNDERGROUND' && (
        <label className="block mb-1.5 text-xs text-slate-400">
          Глубина: <span className="text-slate-200">{draft.depth}м</span>
          <input type="range" min="0.5" max="5" step="0.5" value={draft.depth}
            onChange={(e) => setDraftField({ depth: parseFloat(e.target.value) })} className="w-full" />
        </label>
      )}

      {/* Диаметр */}
      <label className="block mb-2 text-xs text-slate-400">
        Диаметр: <span className="text-slate-200">{draft.diameter}мм</span>
        <input type="range" min="50" max="1000" step="50" value={draft.diameter}
          onChange={(e) => setDraftField({ diameter: parseInt(e.target.value) })} className="w-full" />
      </label>

      {/* Инфо */}
      <div className="text-xs text-slate-400 mb-2">
        Точек: <span className="text-slate-200">{draft.points.length}</span> · Длина: <span className="text-slate-200">{totalLength.toFixed(1)}м</span>
        {draft.points.length < 2 && <div className="text-[11px] text-vovplan-300 mt-0.5">Кликайте по сцене — минимум 2 точки</div>}
      </div>

      {/* Кнопки */}
      <div className="flex gap-1">
        <button onClick={undoDraftPoint} disabled={draft.points.length === 0}
          className="flex-1 px-2 py-1.5 bg-white/5 text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
          <span className="flex items-center justify-center gap-1"><Undo2 size={13} /> Назад</span>
        </button>
        <button onClick={clearDraftPoints} disabled={draft.points.length === 0}
          className="flex-1 px-2 py-1.5 bg-white/5 text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
          <span className="flex items-center justify-center gap-1"><Trash2 size={13} /> Очистить</span>
        </button>
        <button onClick={handleCreate} disabled={draft.points.length < 2}
          className="flex-1 px-2 py-1.5 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-500 disabled:opacity-40 transition-colors">
          <span className="flex items-center justify-center gap-1"><Check size={13} /> Создать</span>
        </button>
      </div>
    </div>
  );
}
