import { useEffect, useState } from 'react';
import { Wrench, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useViewerStore } from '../stores/viewerStore';
import { utilitiesApi } from '../../../shared/api';
import type { UtilityType, UtilityLocation } from '../../../shared/api';

const TYPE_OPTIONS: { value: UtilityType; label: string }[] = [
  { value: 'WATER', label: 'Водопровод' },
  { value: 'GAS', label: 'Газ' },
  { value: 'ELECTRIC', label: 'Электричество' },
  { value: 'SEWAGE', label: 'Канализация' },
  { value: 'TELECOM', label: 'Связь' },
  { value: 'HEAT', label: 'Тепло' },
];

const TYPE_COLORS: Record<UtilityType, string> = {
  WATER: '#2563eb', GAS: '#f59e0b', ELECTRIC: '#dc2626',
  SEWAGE: '#7c3aed', TELECOM: '#10b981', HEAT: '#ea580c',
};

/**
 * Панель редактирования выбранной инженерной сети (клик по трубе → выбор).
 * Меняет имя, тип, расположение, глубину, диаметр, цвет; удаляет сеть.
 * Только для редакторов (MASTER/DESIGNER).
 */
export default function UtilityEditPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const selectedId = useViewerStore((s) => s.selectedUtilityId);
  const selectUtility = useViewerStore((s) => s.selectUtility);
  const utilities = useViewerStore((s) => s.utilities);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const role = useViewerStore((s) => s.role);

  const util = utilities.find((u) => u.id === selectedId);

  const [name, setName] = useState('');
  const [type, setType] = useState<UtilityType>('WATER');
  const [location, setLocation] = useState<UtilityLocation>('UNDERGROUND');
  const [depth, setDepth] = useState(1.5);
  const [diameter, setDiameter] = useState(200);
  const [color, setColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!util) return;
    setName(util.name);
    setType(util.type);
    setLocation(util.location);
    setDepth(util.depth ?? 1.5);
    setDiameter(util.diameter ?? 200);
    setColor(util.color);
  }, [util?.id]);

  const canEdit = role === 'MASTER' || role === 'DESIGNER';
  if (!util || !canEdit) return null;

  const applyLocal = (patch: Partial<typeof util>) => {
    setUtilities(utilities.map((u) => (u.id === util.id ? { ...u, ...patch } : u)));
  };

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await utilitiesApi.update(projectId, util.id, patch);
      queryClient.invalidateQueries({ queryKey: ['utilities', projectId] });
    } catch (err) {
      console.error('Не удалось сохранить сеть:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await utilitiesApi.remove(projectId, util.id);
      setUtilities(utilities.filter((u) => u.id !== util.id));
      selectUtility(null);
      queryClient.invalidateQueries({ queryKey: ['utilities', projectId] });
    } catch (err) {
      console.error('Не удалось удалить сеть:', err);
    }
  };

  return (
    <div className="glass w-64 max-h-full overflow-y-auto pointer-events-auto">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between">
        <span className="hud-title flex items-center gap-1.5"><Wrench size={14} /> Сеть</span>
        <button onClick={() => selectUtility(null)} className="text-slate-500 hover:text-white transition-colors" title="Закрыть">
          <X size={15} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Имя */}
        <div>
          <label className="input-label">Название</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== util.name && (applyLocal({ name }), save({ name }))}
            className="input-field text-sm"
          />
        </div>

        {/* Тип */}
        <div>
          <label className="input-label">Тип</label>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as UtilityType;
              const c = TYPE_COLORS[t];
              setType(t); setColor(c);
              applyLocal({ type: t, color: c }); save({ type: t, color: c });
            }}
            className="input-field text-sm"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Расположение */}
        <div className="flex gap-1.5">
          {(['UNDERGROUND', 'OVERHEAD'] as const).map((loc) => (
            <button
              key={loc}
              onClick={() => { setLocation(loc); applyLocal({ location: loc }); save({ location: loc }); }}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                location === loc ? 'bg-vovplan-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {loc === 'UNDERGROUND' ? 'Подземная' : 'Надземная'}
            </button>
          ))}
        </div>

        {/* Глубина (подземные) */}
        {location === 'UNDERGROUND' && (
          <label className="block text-xs text-slate-400">
            Глубина: <span className="text-slate-200">{depth}м</span>
            <input
              type="range" min="0.5" max="5" step="0.5" value={depth}
              onChange={(e) => { const v = parseFloat(e.target.value); setDepth(v); applyLocal({ depth: v }); }}
              onMouseUp={() => save({ depth })} onTouchEnd={() => save({ depth })}
              className="w-full mt-1"
            />
          </label>
        )}

        {/* Диаметр */}
        <label className="block text-xs text-slate-400">
          Диаметр: <span className="text-slate-200">{diameter}мм</span>
          <input
            type="range" min="50" max="1000" step="50" value={diameter}
            onChange={(e) => { const v = parseInt(e.target.value); setDiameter(v); applyLocal({ diameter: v }); }}
            onMouseUp={() => save({ diameter })} onTouchEnd={() => save({ diameter })}
            className="w-full mt-1"
          />
        </label>

        {/* Цвет */}
        <div>
          <label className="input-label">Цвет</label>
          <input
            type="color" value={color}
            onChange={(e) => { setColor(e.target.value); applyLocal({ color: e.target.value }); }}
            onBlur={() => save({ color })}
            className="w-full h-8 rounded-lg bg-white/5 border border-white/10 cursor-pointer"
          />
        </div>

        {/* Инфо */}
        <div className="text-[11px] text-slate-500">
          Точек: {util.geometry.length} · Автосохранение{saving ? ' …' : ''}
        </div>

        {/* Удалить */}
        <button onClick={handleDelete} className="btn-danger w-full text-xs">
          <span className="flex items-center justify-center gap-1.5"><Trash2 size={14} /> Удалить сеть</span>
        </button>
      </div>
    </div>
  );
}
