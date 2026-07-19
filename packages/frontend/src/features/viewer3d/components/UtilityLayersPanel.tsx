import { useState } from 'react';
import { Wrench, ScanEye } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';
import type { UtilityType } from '../types';

const UTILITY_META: Record<UtilityType, { label: string; color: string }> = {
  WATER: { label: 'Водопровод', color: '#2563eb' },
  GAS: { label: 'Газ', color: '#f59e0b' },
  ELECTRIC: { label: 'Электричество', color: '#dc2626' },
  SEWAGE: { label: 'Канализация', color: '#7c3aed' },
  TELECOM: { label: 'Связь', color: '#10b981' },
  HEAT: { label: 'Тепло', color: '#ea580c' },
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

  // На узких экранах панель по умолчанию свёрнута, чтобы не закрывать сцену
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  const hasUtilities = utilities.length > 0;
  if (!hasUtilities) return null;

  const types = Object.keys(UTILITY_META) as UtilityType[];

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="glass-chip pointer-events-auto"
        title="Инженерные сети"
      >
        <Wrench size={16} /> <span className="text-slate-500 text-xs">{utilities.length}</span>
      </button>
    );
  }

  return (
    <div className="glass pointer-events-auto p-3 w-52 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="hud-title flex items-center gap-1.5"><Wrench size={14} /> Инженерные сети</h3>
        <button onClick={() => setCollapsed(true)} className="text-slate-500 text-xs hover:text-white transition-colors" title="Свернуть">▴</button>
      </div>

      {/* X-Ray toggle */}
      <button
        onClick={() => setXrayMode(!xrayMode)}
        className={`w-full mb-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
          xrayMode
            ? 'bg-vovplan-600 text-white hover:bg-vovplan-500 shadow-lg shadow-vovplan-600/30'
            : 'bg-white/5 text-slate-300 hover:bg-white/10'
        }`}
      >
        <ScanEye size={16} />
        <span>X-Ray (просвет)</span>
      </button>

      {/* Type toggles */}
      <div className="space-y-0.5">
        {types.map((type) => {
          const meta = UTILITY_META[type];
          const isVisible = visibleUtilityTypes[type];
          const count = counts[type] ?? 0;
          if (count === 0) return null;

          return (
            <button
              key={type}
              onClick={() => toggleUtilityType(type)}
              className={`hud-row text-xs ${isVisible ? '' : 'opacity-40'}`}
            >
              {/* Color dot */}
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <span className="flex-1 text-left text-slate-300">{meta.label}</span>
              <span className="text-slate-500">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
