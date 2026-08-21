import { useMemo } from 'react';
import { Fence, X, AlertTriangle } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';
import { FENCE_TYPES, planFence } from '../utils/fenceLayout';

/**
 * Свойства поставленного ограждения.
 *
 * Пока забор рисуют, длина и число секций видны в подсказке — а стоило его
 * поставить, и всё это пропадало: спросить у готового забора, из чего он
 * собран, было негде. Здесь тот же расчёт, что идёт в геометрию, показан
 * числами: сколько секций, какого размера, что не закрылось.
 */
export default function FenceInfoPanel() {
  const fences = useViewerStore((s) => s.fences);
  const selectedFenceId = useViewerStore((s) => s.selectedFenceId);
  const selectFence = useViewerStore((s) => s.selectFence);
  const groundSampler = useViewerStore((s) => s.groundSampler);

  const fence = fences.find((f) => f.id === selectedFenceId) ?? null;
  const spec = fence ? FENCE_TYPES[fence.type] : null;
  const height = fence ? fence.height ?? FENCE_TYPES[fence.type].height : 0;

  const plan = useMemo(() => {
    if (!fence || !spec) return null;
    return planFence(fence.geometry, {
      sectionLength: spec.sectionLength,
      height,
      closed: fence.closed,
      ground: groundSampler ?? undefined,
    });
  }, [fence, spec, height, groundSampler]);

  if (!fence || !spec || !plan) return null;

  const covered = plan.spans.length * spec.sectionLength;

  return (
    <div className="glass w-64 pointer-events-auto p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="hud-title flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: spec.color }} />
          <Fence size={14} /> Ограждение
        </span>
        <button
          onClick={() => selectFence(null)}
          className="text-slate-500 dark:text-slate-400 hover:text-strong transition-colors"
          title="Снять выделение"
        >
          <X size={15} />
        </button>
      </div>

      <div className="text-xs text-strong font-medium mb-2 truncate" title={fence.name}>
        {fence.name}
      </div>

      <dl className="text-xs space-y-1">
        <Row label="Тип" value={spec.label} />
        <Row label="Секций" value={`${plan.spans.length}`} accent />
        <Row label="Размер секции" value={`${spec.sectionLength} × ${height.toFixed(1)} м`} />
        <Row label="Длина по земле" value={`${plan.length.toFixed(1)} м`} />
        <Row label="Закрыто секциями" value={`${covered.toFixed(1)} м`} />
        <Row label="Вершин" value={`${fence.geometry.length}`} />
        <Row label="Контур" value={fence.closed ? 'замкнутый' : 'разомкнутый'} />
      </dl>

      {/* Остаток — не мелочь: именно он объясняет, почему забор не дотянулся
          до поставленной точки. Секцию не подрезать, значит это либо проём,
          либо повод подвинуть вершину. */}
      {plan.remainder >= 0.15 && (
        <div className="mt-2.5 pt-2 border-t border-white/10 flex gap-1.5 text-[11px] text-amber-500 dark:text-amber-400">
          <AlertTriangle size={13} className="shrink-0 mt-px" />
          <span>
            Проём {plan.remainder.toFixed(1)} м — целая секция туда не встаёт.
            {plan.shortEdges > 0 && ` Звеньев короче секции: ${plan.shortEdges}.`}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className={`text-right truncate ${accent ? 'text-strong font-semibold' : 'text-slate-700 dark:text-slate-200'}`}>
        {value}
      </dd>
    </div>
  );
}
