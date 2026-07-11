import { useViewerStore } from '../stores/viewerStore';
import type { UtilityType } from '../types';

const UTILITY_META: Record<UtilityType, { label: string; color: string; icon: string }> = {
  WATER: { label: 'Водопровод', color: '#2563eb', icon: '💧' },
  GAS: { label: 'Газ', color: '#f59e0b', icon: '🔥' },
  ELECTRIC: { label: 'Электричество', color: '#dc2626', icon: '⚡' },
  SEWAGE: { label: 'Канализация', color: '#7c3aed', icon: '🔄' },
  TELECOM: { label: 'Связь', color: '#10b981', icon: '📡' },
  HEAT: { label: 'Тепло', color: '#ea580c', icon: '🌡️' },
};

/**
 * Utility Layers Panel — toggle visibility of each utility type + X-Ray mode.
 * Collapsible panel, floats above the 3D scene.
 */
export default function UtilityLayersPanel() {
  const xrayMode = useViewerStore((s) => s.xrayMode);
  const setXrayMode = useViewerStore((s) => s.setXrayMode);
  const visibleUtilityTypes = useViewerStore((s) => s.visibleUtilityTypes);
  const toggleUtilityType = useViewerStore((s) => s.toggleUtilityType);
  const utilities = useViewerStore((s) => s.utilities);

  // Count networks per type
  const counts: Record<string, number> = {};
  for (const u of utilities) {
    counts[u.type] = (counts[u.type] ?? 0) + 1;
  }

  const hasUtilities = utilities.length > 0;
  if (!hasUtilities) return null;

  const types = Object.keys(UTILITY_META) as UtilityType[];

  return (
    <div className="absolute left-16 top-4 z-20 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 p-3 w-52">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-800">🔧 Инженерные сети</h3>
      </div>

      {/* X-Ray toggle */}
      <button
        onClick={() => setXrayMode(!xrayMode)}
        className={`w-full mb-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
          xrayMode
            ? 'bg-vovplan-600 text-white hover:bg-vovplan-700'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <span>{xrayMode ? '👁' : '👁‍🗨'}</span>
        <span>X-Ray (просвет)</span>
      </button>

      {/* Type toggles */}
      <div className="space-y-1">
        {types.map((type) => {
          const meta = UTILITY_META[type];
          const isVisible = visibleUtilityTypes[type];
          const count = counts[type] ?? 0;
          if (count === 0) return null;

          return (
            <button
              key={type}
              onClick={() => toggleUtilityType(type)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                isVisible ? 'bg-slate-50 hover:bg-slate-100' : 'opacity-40'
              }`}
            >
              {/* Color dot */}
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <span className="flex-1 text-left text-slate-700">{meta.icon} {meta.label}</span>
              <span className="text-slate-400">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
