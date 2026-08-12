import { useState } from 'react';
import { Download, Loader2, Check, Mountain } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';
import { exportSceneToGlb, downloadBlob, exportFileName } from '../utils/exportScene';

/** Человеческий размер файла: «84,3 МБ» вместо 88412160 */
function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

/**
 * Выгрузка сцены в файл GLB.
 *
 * Рельеф выключен по умолчанию: он тяжелее всего остального вместе взятого
 * (сотни тысяч треугольников плюс подложка), а нужен далеко не всегда — чаще
 * человеку нужны расставленные объекты и ограждение, чтобы открыть их в
 * Blender или отправить заказчику.
 */
export default function ExportScenePanel({ projectName }: { projectName: string }) {
  const sceneGetter = useViewerStore((s) => s.sceneGetter);
  const [withTerrain, setWithTerrain] = useState(false);
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const run = async () => {
    const scene = sceneGetter?.();
    if (!scene) {
      setError('Сцена ещё не готова — подождите загрузки');
      return;
    }

    setBusy(true);
    setError('');
    setDone('');
    try {
      /*
       * Экспортёр работает в главном потоке и на большой сцене держит его
       * секунды. Отдаём браузеру кадр на отрисовку «Собираю сцену», иначе
       * человек увидит замершую кнопку и решит, что нажатие не сработало.
       */
      setStage('Собираю сцену');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const { blob, triangles, instances } = await exportSceneToGlb(scene, {
        includeTerrain: withTerrain,
        onProgress: (s) => setStage(s),
      });

      downloadBlob(blob, exportFileName(projectName));
      setDone(
        `${humanSize(blob.size)} · ${triangles.toLocaleString('ru-RU')} треугольников` +
          (instances > 0 ? ` · разложено копий: ${instances.toLocaleString('ru-RU')}` : ''),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  return (
    <div className="glass w-64 pointer-events-auto p-3.5">
      <div className="hud-title flex items-center gap-1.5 mb-2.5">
        <Download size={14} /> Скачать сцену
      </div>

      <button
        onClick={() => setWithTerrain(!withTerrain)}
        disabled={busy}
        className={`w-full mb-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
          withTerrain
            ? 'bg-vovplan-600 text-white'
            : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
        }`}
      >
        <Mountain size={13} /> {withTerrain ? 'С рельефом' : 'Без рельефа'}
      </button>

      <p className="text-[11px] text-muted mb-2.5 leading-snug">
        {withTerrain
          ? 'Рельеф с подложкой — файл выйдет тяжёлым, зато сцена будет полной.'
          : 'Только объекты, ограждения и сети. Рельеф можно добавить кнопкой выше.'}
      </p>

      <button
        onClick={run}
        disabled={busy}
        className="w-full px-2 py-1.5 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-500 disabled:opacity-60 transition-colors"
      >
        <span className="flex items-center justify-center gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {busy ? stage || 'Готовлю…' : 'Скачать GLB'}
        </span>
      </button>

      {done && (
        <p className="text-[11px] text-emerald-400 mt-2 flex items-start gap-1">
          <Check size={13} className="shrink-0 mt-px" /> <span>{done}</span>
        </p>
      )}
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}

      <p className="text-[10px] text-muted mt-2.5 leading-snug">
        GLB открывается в Blender, 3ds Max и просмотрщике Windows.
      </p>
    </div>
  );
}
