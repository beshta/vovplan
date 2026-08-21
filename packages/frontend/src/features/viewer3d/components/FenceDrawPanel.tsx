import { useMemo } from 'react';
import { Fence, Undo2, Trash2, Check, X, Spline, Eye, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useViewerStore } from '../stores/viewerStore';
import { fencesApi } from '../../../shared/api';
import { FENCE_TYPES, planFence } from '../utils/fenceLayout';
import type { FenceData, FenceType } from '../types';

const TYPES = Object.entries(FENCE_TYPES) as [FenceType, (typeof FENCE_TYPES)[FenceType]][];

/**
 * HUD-панель постановки ограждения (вне Canvas — кнопки всегда кликабельны).
 * Тип / высота / замкнутость + список уже поставленных.
 * 3D-превью и приём кликов — в FenceCreator.
 */
export default function FenceDrawPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const draft = useViewerStore((s) => s.fenceDraft);
  const setField = useViewerStore((s) => s.setFenceDraftField);
  const undoPoint = useViewerStore((s) => s.undoFencePoint);
  const clearDraft = useViewerStore((s) => s.clearFenceDraft);
  const fences = useViewerStore((s) => s.fences);
  const setFences = useViewerStore((s) => s.setFences);
  const setFenceDrawMode = useViewerStore((s) => s.setFenceDrawMode);
  const showFences = useViewerStore((s) => s.showFences);
  const setShowFences = useViewerStore((s) => s.setShowFences);
  const selectedFenceId = useViewerStore((s) => s.selectedFenceId);
  const selectFence = useViewerStore((s) => s.selectFence);

  const groundSampler = useViewerStore((s) => s.groundSampler);

  const spec = FENCE_TYPES[draft.type];
  const height = draft.height ?? spec.height;

  /*
   * Считаем той же раскладкой, что идёт в геометрию.
   *
   * Раньше в подсказке стояло «длина ÷ длина секции, округлить вверх», и
   * число расходилось с тем, что вставало в сцену: на углах набор начинается
   * заново, а остаток секцией не закрывается. Человек видел 5 секций в
   * панели и 4 на площадке.
   */
  const plan = useMemo(
    () => planFence(draft.points, {
      sectionLength: spec.sectionLength,
      height,
      closed: draft.closed,
      ground: groundSampler ?? undefined,
    }),
    [draft.points, draft.closed, spec.sectionLength, height, groundSampler],
  );

  const reload = async () => {
    const updated = await fencesApi.list(projectId);
    setFences(updated.data);
    queryClient.invalidateQueries({ queryKey: ['fences', projectId] });
  };

  const handleCreate = async () => {
    if (draft.points.length < 2) return;
    try {
      await fencesApi.create(projectId, {
        name: `${spec.label} ${new Date().toLocaleTimeString('ru-RU')}`,
        type: draft.type,
        geometry: draft.points,
        // Типовую высоту не отправляем: тогда она поедет за типом, если его
        // потом поменяют, а не застынет числом от старого
        height: draft.height ?? undefined,
        closed: draft.closed,
      });
      clearDraft();
      await reload();
    } catch (err) {
      console.error('Не удалось поставить ограждение:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fencesApi.remove(projectId, id);
      if (selectedFenceId === id) selectFence(null);
      await reload();
    } catch (err) {
      console.error('Не удалось убрать ограждение:', err);
    }
  };

  const close = () => { clearDraft(); setFenceDrawMode(false); };

  return (
    <div className="glass w-64 pointer-events-auto p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="hud-title flex items-center gap-1.5"><Fence size={14} /> Ограждение</span>
        <button onClick={close} className="text-slate-500 dark:text-slate-400 hover:text-strong transition-colors" title="Закрыть режим"><X size={15} /></button>
      </div>

      {/* Тип */}
      <div className="flex flex-col gap-1 mb-2">
        {TYPES.map(([value, type]) => (
          <button
            key={value}
            // Высота сбрасывается к типовой: у бетонного забора и фан-барьера
            // она отличается вдвое, и оставлять чужую — почти всегда ошибка
            onClick={() => setField({ type: value, height: null })}
            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              draft.type === value ? 'text-strong ring-2 ring-white/40' : 'bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-white/10'
            }`}
            style={draft.type === value ? { backgroundColor: type.color } : {}}
          >
            <span>{type.label}</span>
            <span className="opacity-70">{type.sectionLength}×{type.height}м</span>
          </button>
        ))}
      </div>

      {/* Высота */}
      <label className="block mb-1.5 text-xs text-muted">
        Высота: <span className="text-slate-700 dark:text-slate-200">{height.toFixed(1)}м</span>
        {draft.height === null && <span className="opacity-60"> (типовая)</span>}
        <input
          type="range" min="0.5" max="4" step="0.1" value={height}
          onChange={(e) => setField({ height: parseFloat(e.target.value) })}
          className="w-full"
        />
      </label>

      {/* Замкнутость */}
      <button
        onClick={() => setField({ closed: !draft.closed })}
        className={`w-full mb-2 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
          draft.closed ? 'bg-vovplan-600 text-white' : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
        }`}
      >
        <Spline size={13} /> {draft.closed ? 'Замкнутый контур' : 'Разомкнутая линия'}
      </button>

      {/* Инфо */}
      <div className="text-xs text-muted mb-2">
        Точек: <span className="text-slate-700 dark:text-slate-200">{draft.points.length}</span>
        {' · '}Длина: <span className="text-slate-700 dark:text-slate-200">{plan.length.toFixed(1)}м</span>
        {plan.length > 0 && <> · <span className="text-slate-700 dark:text-slate-200">{plan.spans.length}</span> секц.</>}
        {plan.remainder >= 0.15 && (
          <div className="text-[11px] text-amber-500 dark:text-amber-400 mt-0.5">
            Проём {plan.remainder.toFixed(1)}м: целая секция не встаёт
          </div>
        )}
        {draft.points.length < 2 && <div className="text-[11px] text-vovplan-300 mt-0.5">Двойной клик по земле — минимум 2 точки</div>}
      </div>

      {/* Кнопки.
          Тремя в ряд не помещаются: «Поставить» длиннее прочих подписей, а
          flex-элементы не сжимаются меньше своего содержимого — строка
          вылезала за колонку панелей и обрезалась её прокруткой.
          Поэтому главное действие идёт своей строкой, min-w-0 страхует
          остальные две от того же на других языках и размерах шрифта. */}
      <div className="flex gap-1 mb-1">
        <button onClick={undoPoint} disabled={draft.points.length === 0}
          className="flex-1 min-w-0 px-2 py-1.5 bg-white/5 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
          <span className="flex items-center justify-center gap-1"><Undo2 size={13} /> Назад</span>
        </button>
        <button onClick={clearDraft} disabled={draft.points.length === 0}
          className="flex-1 min-w-0 px-2 py-1.5 bg-white/5 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
          <span className="flex items-center justify-center gap-1"><Trash2 size={13} /> Очистить</span>
        </button>
      </div>
      <button onClick={handleCreate} disabled={draft.points.length < 2}
        className="w-full px-2 py-1.5 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-500 disabled:opacity-40 transition-colors">
        <span className="flex items-center justify-center gap-1"><Check size={13} /> Поставить</span>
      </button>

      {/* Уже поставленные — убрать ошибку иначе нечем */}
      {fences.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-white/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="hud-title">Поставлено ({fences.length})</span>
            <button
              onClick={() => setShowFences(!showFences)}
              className="text-slate-500 dark:text-slate-400 hover:text-strong transition-colors"
              title={showFences ? 'Скрыть ограждения в сцене' : 'Показать ограждения'}
            >
              {showFences ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {fences.map((f) => (
              <FenceRow
                key={f.id}
                fence={f}
                selected={selectedFenceId === f.id}
                onSelect={() => selectFence(selectedFenceId === f.id ? null : f.id)}
                onDelete={() => handleDelete(f.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Строка списка: собственное имя, число секций и длина — как в ведомости */
function FenceRow({
  fence,
  selected,
  onSelect,
  onDelete,
}: {
  fence: FenceData;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const groundSampler = useViewerStore((s) => s.groundSampler);
  const spec = FENCE_TYPES[fence.type];
  const plan = useMemo(
    () => planFence(fence.geometry, {
      sectionLength: spec.sectionLength,
      height: fence.height ?? spec.height,
      closed: fence.closed,
      ground: groundSampler ?? undefined,
    }),
    [fence, spec, groundSampler],
  );

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] cursor-pointer transition-colors ${
        selected ? 'bg-white/15 text-strong' : 'bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-white/10'
      }`}
      title={`${spec.label}: ${plan.spans.length} секц. по ${spec.sectionLength}м, длина ${plan.length.toFixed(1)}м`}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: spec.color }} />
      <span className="flex-1 truncate">{spec.label}</span>
      <span className="opacity-60 shrink-0">{plan.spans.length} секц. · {plan.length.toFixed(0)}м</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
        title="Убрать ограждение"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
