import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link2Off } from 'lucide-react';
import { ProjectRole } from '@vovplan/shared';
import type { SharedViewPayload } from '../../../shared/api';
import { useViewerStore } from '../stores/viewerStore';
import { publicFrameSize } from '../utils/publicFrame';
import Scene from './Scene';
import NavigationHelp from './NavigationHelp';

/**
 * Просмотр сцены посторонним — одна реализация на все входы без регистрации.
 *
 * Входов теперь четыре: share-ссылка, открытый проект, витрина и тихий
 * просмотр из админки. Каждый со своим запросом, но с одинаковыми правилами:
 * роль внешнего наблюдателя, без сетей и комментариев. Заборы — часть
 * внешнего вида площадки, они здесь есть. Держать это в четырёх местах —
 * значит однажды поправить три.
 */

/**
 * Разложить полученную сцену по стору.
 *
 * Чистка слоёв в начале — не перестраховка. Стор переживает уход со страницы,
 * и забор из проекта, открытого в этой же вкладке минуту назад, оказался бы
 * на публичной сцене, куда его никто не звал.
 */
export function usePublicScene(data: SharedViewPayload | undefined, autoFly = true) {
  const initFromRole = useViewerStore((s) => s.initFromRole);
  const setObjects = useViewerStore((s) => s.setObjects);
  const setModelCache = useViewerStore((s) => s.setModelCache);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const setTerrainMeta = useViewerStore((s) => s.setTerrainMeta);
  const setProceduralTerrain = useViewerStore((s) => s.setProceduralTerrain);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setAnnotations = useViewerStore((s) => s.setAnnotations);
  const setFences = useViewerStore((s) => s.setFences);
  const flyTo = useViewerStore((s) => s.flyTo);

  // Подпись в URL рельефа меняется при каждом ответе API — без отрезания
  // повторный запрос считался бы новым проектом и заново запускал перелёт
  const identity = data
    ? `${data.project.name}|${(data.project.terrainUrl ?? '').split('?')[0]}`
    : '';

  useEffect(() => {
    initFromRole(ProjectRole.EXTERNAL_SPECTATOR);
    setUtilities([]);
    setAnnotations([]);
  }, [initFromRole, setUtilities, setAnnotations]);

  useEffect(() => {
    if (!data || !identity) return;

    // Стор переживает уход со страницы: чужой незавершённый перелёт отсюда
    // каждый кадр тянул камеру, и она «приближалась без остановки»
    useViewerStore.getState().resetViewer();
    initFromRole(ProjectRole.EXTERNAL_SPECTATOR);

    setObjects(
      data.objects.map((o) => ({
        id: o.id,
        modelId: o.modelId,
        name: o.name,
        authorId: '',
        authorName: '',
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        visible: true,
        hidden: false,
        description: o.description,
        locked: true,
      })),
    );

    const cache: Record<string, { glbUrl: string; lod1Url: string | null; lod2Url: string | null }> = {};
    for (const m of data.models) {
      cache[m.id] = { glbUrl: m.glbUrl, lod1Url: m.lod1Url, lod2Url: m.lod2Url };
    }
    setModelCache(cache);

    setTerrainUrl(data.project.terrainUrl);
    setTerrainMeta(data.project.terrainMeta ?? null);
    // Иначе стор оставляет процедурный шум поверх настоящего рельефа —
    // рабочий вьюер это выключает, публичный раньше забывал
    setProceduralTerrain(!data.project.terrainUrl);

    setFences(data.fences ?? []);

    if (!autoFly) return;

    const start = data.startPresetId ? data.presets.find((p) => p.id === data.startPresetId) : null;
    if (start) {
      flyTo({ position: start.position, target: start.target });
      return;
    }

    const meta = data.project.terrainMeta;
    if (meta?.widthM && meta?.heightM) {
      const size = Math.max(meta.widthM, meta.heightM);
      flyTo({
        position: [size * 0.35, size * 0.4, size * 0.35],
        target: [0, 0, 0],
      });
    }
    // data читаем только когда сменился проект: иначе новый подписанный URL
    // рельефа заново запускал бы перелёт
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity
  }, [identity, autoFly]);

  return flyTo;
}

/**
 * Рамка канваса: по центру, не больше потолка для этого экрана.
 */
function PublicFrame({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const apply = () => {
      setSize(publicFrameSize(
        Math.max(window.screen.width, window.screen.height),
        el.clientWidth,
        el.clientHeight,
      ));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={host} className="relative flex-1 flex items-center justify-center bg-slate-950 overflow-hidden">
      <div style={{ width: size.width, height: size.height }} className="relative">
        {children}
      </div>
    </div>
  );
}

export default function PublicSceneView({ data, isLoading, error, badge }: {
  data: SharedViewPayload | undefined;
  isLoading: boolean;
  error: unknown;
  /** Подпись в углу: чем именно открыт проект */
  badge: string;
}) {
  const flyTo = usePublicScene(data);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="inline-block w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : 'Ссылка недействительна';
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-slate-300 gap-3">
        <div className="text-slate-600"><Link2Off size={48} strokeWidth={1.5} /></div>
        <h1 className="text-lg font-semibold">Просмотр недоступен</h1>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <header className="bg-slate-950 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="font-display text-vovplan-400 font-bold tracking-wide shrink-0">VOVPLAN</a>
          <div className="h-5 w-px bg-slate-700 shrink-0" />
          <h1 className="text-base font-semibold truncate">{data.project.name}</h1>
        </div>
        <span className="text-[11px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full shrink-0">
          {badge}
        </span>
      </header>

      <PublicFrame>
        <Scene currentUserId="" projectId="" shared />
        <NavigationHelp />

        {data.presets.length > 0 && (
          <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-20 glass rounded-full flex items-center gap-1.5 px-2 py-1.5 max-w-[70%] overflow-x-auto">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 px-1 shrink-0">Виды</span>
            {data.presets.map((p) => (
              <button
                key={p.id}
                onClick={() => flyTo({ position: p.position, target: p.target })}
                className="px-3 py-1 rounded-full text-xs bg-slate-800 text-slate-200 hover:bg-vovplan-600 hover:text-white transition-colors shrink-0"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </PublicFrame>
    </div>
  );
}
