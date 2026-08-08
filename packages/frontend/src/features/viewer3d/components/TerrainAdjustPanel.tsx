import { useEffect, useRef, useState } from 'react';
import { Mountain, RotateCcw } from 'lucide-react';
import { terrainApi, TERRAIN_ADJUST_OFF, type TerrainAdjust, type TerrainMeta } from '../../../shared/api';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Правка рельефа.
 *
 * Открытые данные о высотах идут сеткой 30 м. На участке в двести метров это
 * тринадцать точек поперёк, и замер показал разброс между источниками до 12 м —
 * больше, чем сам рельеф. Перейти на источник точнее нельзя: данных лучше по
 * стране в открытом доступе нет, а те, что точнее по паспорту, на таком
 * масштабе шумят сильнее.
 *
 * Поэтому здесь не автоматика, а три ручки. Человек, который на площадке бывал,
 * знает про неё больше любого спутника — пусть скажет.
 *
 * Настройка общая для проекта и не трогает сам снимок высот: исходные данные
 * остаются, в любой момент можно вернуть как было.
 */
export default function TerrainAdjustPanel({
  projectId,
  meta,
}: {
  projectId: string;
  meta: TerrainMeta;
}) {
  const setTerrainMeta = useViewerStore((s) => s.setTerrainMeta);
  const [value, setValue] = useState<TerrainAdjust>(meta.adjust ?? TERRAIN_ADJUST_OFF);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Пришло чужое изменение по сокету — подхватываем, но не поверх того,
  // что человек прямо сейчас тянет
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setValue(meta.adjust ?? TERRAIN_ADJUST_OFF);
  }, [meta.adjust]);

  /**
   * Пересчёт рельефа идёт по всей сетке, поэтому на каждое движение ползунка
   * его гонять нельзя — картинка встанет колом. Показываем результат сразу
   * по отпусканию, а на сервер отправляем тогда же.
   */
  const commit = async (next: TerrainAdjust) => {
    dragging.current = false;
    setValue(next);
    setTerrainMeta({ ...meta, adjust: next });
    setSaving(true);
    setError(null);
    try {
      await terrainApi.adjust(projectId, next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const relief = Math.max(meta.maxElev - meta.minElev, 0);
  const off =
    value.smooth === TERRAIN_ADJUST_OFF.smooth &&
    value.level === TERRAIN_ADJUST_OFF.level &&
    value.scale === TERRAIN_ADJUST_OFF.scale;

  const rows: {
    key: keyof TerrainAdjust;
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
  }[] = [
    {
      key: 'smooth',
      label: 'Сглаживание',
      hint: 'Убирает ступеньки, которых в исходных данных нет',
      min: 0,
      max: 50,
      step: 1,
      format: (v) => (v === 0 ? 'выкл' : `${v} м`),
    },
    {
      key: 'level',
      label: 'Выравнивание',
      hint: 'Тянет площадку к её средней отметке',
      min: 0,
      max: 1,
      step: 0.05,
      format: (v) => (v === 0 ? 'выкл' : v === 1 ? 'ровно' : `${Math.round(v * 100)}%`),
    },
    {
      key: 'scale',
      label: 'Высоты',
      hint: 'Единица — честные метры',
      min: 0,
      max: 2,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}×`,
    },
  ];

  return (
    <div className="pt-3 border-t border-slate-900/10 dark:border-white/10">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <Mountain size={12} /> Правка рельефа
        </span>
        {!off && (
          <button
            onClick={() => commit(TERRAIN_ADJUST_OFF)}
            title="Вернуть исходные высоты"
            className="text-[11px] text-muted hover:text-strong flex items-center gap-1 transition-colors"
          >
            <RotateCcw size={11} /> Сброс
          </button>
        )}
      </div>

      {rows.map((row) => (
        <label key={row.key} className="block mb-2">
          <span className="flex items-center justify-between text-[11px]">
            <span className="text-muted" title={row.hint}>{row.label}</span>
            <span className="text-strong tabular-nums">{row.format(value[row.key])}</span>
          </span>
          <input
            type="range"
            min={row.min}
            max={row.max}
            step={row.step}
            value={value[row.key]}
            onPointerDown={() => { dragging.current = true; }}
            onChange={(e) => setValue({ ...value, [row.key]: Number(e.target.value) })}
            onPointerUp={(e) => commit({ ...value, [row.key]: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => commit({ ...value, [row.key]: Number((e.target as HTMLInputElement).value) })}
            className="w-full mt-0.5 accent-vovplan-600"
          />
        </label>
      ))}

      <p className="text-[10px] text-muted leading-relaxed">
        Перепад на площадке {relief.toFixed(1)} м. Высоты приходят сеткой 30 м —
        на участке такого размера это оценка, а не измерение.
      </p>
      {saving && <p className="text-[10px] text-muted mt-1">Сохраняю…</p>}
      {error && <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}
