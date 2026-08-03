import { Activity, X } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';

const fmt = (n: number) => n.toLocaleString('ru-RU');

/**
 * Панель счётчиков сцены. Живёт вне Canvas — так она рисуется и когда вкладка
 * в фоне, и не тянет за собой перерисовку 3D.
 */
export default function PerfPanel() {
  const stats = useViewerStore((s) => s.perfStats);
  const setShowPerf = useViewerStore((s) => s.setShowPerf);

  // Ориентиры: 55+ комфортно, 30–55 терпимо, ниже — тяжело
  const fps = stats?.fps ?? 0;
  const fpsColor =
    fps >= 55 ? 'text-emerald-600 dark:text-emerald-400'
      : fps >= 30 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  const rows: [string, string][] = stats
    ? [
        ['Треугольники', fmt(stats.triangles)],
        ['Вызовов отрисовки', fmt(stats.calls)],
        ['Геометрий', fmt(stats.geometries)],
        ['Текстур', fmt(stats.textures)],
      ]
    : [];

  return (
    <div className="glass w-52 px-3.5 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="hud-title flex items-center gap-1.5">
          <Activity size={14} /> Нагрузка
        </span>
        <button
          onClick={() => setShowPerf(false)}
          title="Скрыть"
          className="text-slate-500 dark:text-slate-400 hover:text-strong transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {!stats ? (
        <p className="text-xs text-muted">Измерение...</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={`font-display text-2xl font-bold tabular-nums ${fpsColor}`}>{fps}</span>
            <span className="text-xs text-muted">кадров/с</span>
          </div>
          <div className="space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">{k}</span>
                <span className="font-mono tabular-nums text-strong">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
