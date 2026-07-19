import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ProjectRole } from '@vovplan/shared';
import { sharedApi } from '../shared/api';
import { useViewerStore } from '../features/viewer3d/stores/viewerStore';
import Scene from '../features/viewer3d/components/Scene';
import NavigationHelp from '../features/viewer3d/components/NavigationHelp';

/**
 * Публичный просмотр по share-ссылке — БЕЗ регистрации.
 * Роль External Spectator: только внешний вид сцены — без инженерных сетей,
 * комментариев, редактирования и realtime.
 */
export default function SharedViewerPage() {
  const { token } = useParams<{ token: string }>();

  const initFromRole = useViewerStore((s) => s.initFromRole);
  const setObjects = useViewerStore((s) => s.setObjects);
  const setModelCache = useViewerStore((s) => s.setModelCache);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setAnnotations = useViewerStore((s) => s.setAnnotations);
  const flyTo = useViewerStore((s) => s.flyTo);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared', token],
    queryFn: () => sharedApi.get(token!),
    enabled: !!token,
    retry: false,
  });

  // ── Инициализация стора данными публичной сцены ──
  useEffect(() => {
    initFromRole(ProjectRole.EXTERNAL_SPECTATOR);
    // Гарантированно чистим слои, недоступные внешнему наблюдателю
    setUtilities([]);
    setAnnotations([]);
  }, [initFromRole, setUtilities, setAnnotations]);

  useEffect(() => {
    if (!data) return;

    setObjects(
      data.objects.map((o) => ({
        id: o.id,
        modelId: o.modelId,
        name: o.name,
        authorId: '',
        authorName: o.authorName,
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

    // Стартовый вид из ссылки
    const start = data.startPresetId
      ? data.presets.find((p) => p.id === data.startPresetId)
      : null;
    if (start) {
      flyTo({ position: start.position, target: start.target });
    }
  }, [data, setObjects, setModelCache, setTerrainUrl, flyTo]);

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
        <div className="text-5xl">🔗</div>
        <h1 className="text-lg font-semibold">Просмотр недоступен</h1>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Шапка публичного просмотра */}
      <header className="bg-slate-950 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-vovplan-400 font-bold shrink-0">VOVPLAN</span>
          <div className="h-5 w-px bg-slate-700 shrink-0" />
          <h1 className="text-base font-semibold truncate">{data.project.name}</h1>
        </div>
        <span className="text-[11px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full shrink-0">
          Публичный просмотр
        </span>
      </header>

      {/* Сцена */}
      <div className="relative flex-1">
        <Scene currentUserId="" projectId="" shared />
        <NavigationHelp />

        {/* Пресеты видов (только просмотр) */}
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
      </div>
    </div>
  );
}
