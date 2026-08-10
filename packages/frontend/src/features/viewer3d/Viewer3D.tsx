import { useEffect, useState } from 'react';
import { Package, Construction, Footprints, X, Camera, Globe, MousePointerClick, Brush } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectRole } from '@vovplan/shared';
import { useViewerStore } from './stores/viewerStore';
import { sceneApi, modelsApi, utilitiesApi, fencesApi, projectsApi, commentsApi } from '../../shared/api';
import type { Model3DPayload, UtilityNetworkPayload, CommentPayload } from '../../shared/api';
import Scene from './components/Scene';
import ViewerToolbar from './components/ViewerToolbar';
import ObjectInfoPanel from './components/ObjectInfoPanel';
import ModelLibrary from './components/ModelLibrary';
import NavigationHelp from './components/NavigationHelp';
import UtilityLayersPanel from './components/UtilityLayersPanel';
import UtilityDrawPanel from './components/UtilityDrawPanel';
import FenceDrawPanel from './components/FenceDrawPanel';
import TerrainPanel from './components/TerrainPanel';
import AnnotationsList from './components/AnnotationsList';
import UtilityEditPanel from './components/UtilityEditPanel';
import AnnotationEditPanel from './components/AnnotationEditPanel';
import PresetsBar from './components/PresetsBar';
import PerfPanel from './components/PerfPanel';
import SceneObjectsList from './components/SceneObjectsList';
import TouchJoystick from './components/TouchJoystick';
import { isTouchDevice } from './utils/deviceProfiler';
import PresenceBar from '../collaboration/PresenceBar';
import { useRealtime } from '../collaboration/useRealtime';
import { useAuthStore } from '../../shared/authStore';
import { useIsMobile } from '../../shared/useIsMobile';

interface Viewer3DProps {
  projectId: string;
  role: ProjectRole;
  userId: string;
}

/**
 * VOVPLAN 3D Viewer — main entry point.
 * Loads scene objects and model library from real API.
 */
export default function Viewer3D({ projectId, role, userId }: Viewer3DProps) {
  const initFromRole = useViewerStore((s) => s.initFromRole);
  const setObjects = useViewerStore((s) => s.setObjects);
  const setModelCache = useViewerStore((s) => s.setModelCache);
  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setFences = useViewerStore((s) => s.setFences);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const setTerrainMeta = useViewerStore((s) => s.setTerrainMeta);
  const setAnnotations = useViewerStore((s) => s.setAnnotations);
  const addObject = useViewerStore((s) => s.addObject);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);
  const fpPoint = useViewerStore((s) => s.fpPoint);
  const utilityDrawMode = useViewerStore((s) => s.utilityDrawMode);
  const fenceDrawMode = useViewerStore((s) => s.fenceDrawMode);
  const showPerf = useViewerStore((s) => s.showPerf);
  // Подсказку показывает сам факт, что активный инструмент ждёт точку —
  // перечислять инструменты здесь значит забыть про следующий
  const drawingPoints = useViewerStore((s) => !!s.groundHandlers?.onPlace || s.measureMode);
  const placedPoints = useViewerStore((s) => s.placedPoints);
  const mode = useViewerStore((s) => s.mode);
  const annDrawMode = useViewerStore((s) => s.annDrawMode);
  const setAnnDrawMode = useViewerStore((s) => s.setAnnDrawMode);
  const setMapImportOpen = useViewerStore((s) => s.setMapImportOpen);

  const userName = useAuthStore((s) => s.user?.displayName ?? s.user?.email ?? 'Гость');

  // ── Снимок сцены на превью карточки проекта ──
  const queryClient = useQueryClient();
  const [capturing, setCapturing] = useState(false);
  const [previewSaved, setPreviewSaved] = useState(false);

  const capturePreview = async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    setCapturing(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('не удалось снять кадр');
      await projectsApi.uploadPreview(projectId, blob);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setPreviewSaved(true);
      setTimeout(() => setPreviewSaved(false), 2500);
    } catch {
      /* сеть/права — молча: превью не критично для работы со сценой */
    } finally {
      setCapturing(false);
    }
  };

  // Стор вьювера — модульный синглтон и переживает уход со страницы. Без сброса
  // в новый проект переносились чужие выделения, режимы и, что хуже всего,
  // незавершённый перелёт камеры: он каждый кадр возвращал камеру в одну позу,
  // и повернуть её было нельзя.
  useEffect(() => {
    useViewerStore.getState().resetViewer();
  }, [projectId]);

  useEffect(() => {
    initFromRole(role);
  }, [role, initFromRole]);

  // ── Real-time collaboration ──
  useRealtime(projectId, userName);

  // ── Load scene objects ──
  const { data: sceneData } = useQuery({
    queryKey: ['scene-objects', projectId],
    queryFn: () => sceneApi.listObjects(projectId),
    enabled: !!projectId,
  });

  // ── Load models (for modelUrls mapping) ──
  const { data: modelsData } = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => modelsApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Load utility networks ──
  const { data: utilitiesData } = useQuery({
    queryKey: ['utilities', projectId],
    queryFn: () => utilitiesApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Load fences (ограждение площадки) ──
  const { data: fencesData } = useQuery({
    queryKey: ['fences', projectId],
    queryFn: () => fencesApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Load project details (for terrainUrl) ──
  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  });

  // ── Load comments / annotations ──
  const { data: commentsData } = useQuery({
    queryKey: ['comments', projectId],
    queryFn: () => commentsApi.list(projectId),
    enabled: !!projectId,
  });

  // ── Sync API data → viewer store ──
  useEffect(() => {
    if (!sceneData?.data) return;
    setObjects(
      sceneData.data.map((o) => ({
        id: o.id,
        modelId: o.modelId,
        name: o.name,
        authorId: o.authorId,
        authorName: o.authorName,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        visible: o.visible,
        hidden: o.hidden,
        description: o.description,
        docUrl: o.docUrl,
        createdAt: o.createdAt,
        locked: o.locked,
        groundSnap: o.groundSnap,
      })),
    );
  }, [sceneData, setObjects]);

  // ── Build modelCache (modelId → {glbUrl, lod1Url, lod2Url}) ──
  useEffect(() => {
    if (!modelsData?.data) return;
    const cache: Record<string, { glbUrl: string; lod1Url: string | null; lod2Url: string | null }> = {};
    for (const m of modelsData.data) {
      cache[m.id] = {
        glbUrl: m.glbUrl,
        lod1Url: m.lod1Url,
        lod2Url: m.lod2Url,
      };
    }
    setModelCache(cache);
  }, [modelsData, setModelCache]);

  // ── Sync utilities → viewer store ──
  useEffect(() => {
    if (!utilitiesData?.data) return;
    setUtilities(
      utilitiesData.data.map((u: UtilityNetworkPayload) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        location: u.location,
        geometry: u.geometry,
        depth: u.depth,
        diameter: u.diameter,
        material: u.material,
        color: u.color,
      })),
    );
  }, [utilitiesData, setUtilities]);

  // ── Sync fences → viewer store ──
  useEffect(() => {
    if (!fencesData?.data) return;
    setFences(fencesData.data);
  }, [fencesData, setFences]);

  // ── Sync terrainUrl + meta → viewer store ──
  useEffect(() => {
    if (!projectData) return;
    setTerrainUrl(projectData.terrainUrl ?? null);
    setTerrainMeta((projectData as any).terrainMeta ?? null);
    // Есть загруженный рельеф — показываем именно его, а не процедурный шум
    if (projectData.terrainUrl) useViewerStore.getState().setProceduralTerrain(false);
  }, [projectData, setTerrainUrl, setTerrainMeta]);

  // ── При появлении реального ландшафта — обзорный вид на всю площадку ──
  const metaKey = (projectData as any)?.terrainMeta?.textureUrl ?? null;
  useEffect(() => {
    if (!metaKey) return;
    const meta = (projectData as any).terrainMeta;
    const size = Math.max(meta.widthM, meta.heightM);
    useViewerStore.getState().flyTo({
      position: [size * 0.35, size * 0.4, size * 0.35],
      target: [0, 0, 0],
    });
  }, [metaKey]);

  // ── Sync comments → annotations store ──
  useEffect(() => {
    if (!commentsData?.data) return;
    const annotations = commentsData.data
      .filter((c: CommentPayload) => c.type && c.geometry)
      .map((c: CommentPayload) => ({
        id: c.id,
        type: c.type as 'arrow' | 'line' | 'freehand' | 'pin',
        points: c.geometry as [number, number, number][],
        color: c.color ?? '#f59e0b',
        width: c.width ?? 0.4,
        text: c.text,
        authorId: c.authorId,
        authorName: c.authorName,
        resolved: c.resolved,
        createdAt: c.createdAt,
      }));
    setAnnotations(annotations);
  }, [commentsData, setAnnotations]);

  // ── Place a model from the library onto the scene ──
  const handlePlaceObject = async (model: Model3DPayload) => {
    const newObj = await sceneApi.createObject(projectId, {
      name: model.name,
      modelId: model.id,
      position: [0, 0, 0],
    });

    // Update model cache with new model's LOD URLs
    const cache = { ...useViewerStore.getState().modelCache };
    cache[model.id] = {
      glbUrl: model.glbUrl,
      lod1Url: model.lod1Url,
      lod2Url: model.lod2Url,
    };
    setModelCache(cache);

    addObject({
      id: newObj.id,
      modelId: model.id,
      name: newObj.name,
      authorId: newObj.authorId,
      authorName: newObj.authorName,
      position: newObj.position,
      rotation: newObj.rotation,
      scale: newObj.scale,
      visible: true,
      hidden: false,
    });
  };

  const canEdit = role === 'MASTER' || role === 'DESIGNER';
  const isMobile = useIsMobile();
  const isTouch = isTouchDevice();
  const [libraryOpen, setLibraryOpen] = useState(false);

  /**
   * Подсказку первого шага можно закрыть, и она не возвращается.
   *
   * Висела она до появления первого объекта в сцене, то есть у того, кто
   * пришёл просто осмотреться, — постоянно и ровно посреди экрана. Отметку
   * держим по проекту: в другом проекте человек начинает с нуля, и подсказка
   * там снова уместна.
   */
  const hintKey = `vovplan.hint.start.${projectId}`;
  const [hintClosed, setHintClosed] = useState(() => {
    try {
      return localStorage.getItem(hintKey) === '1';
    } catch {
      // Приватный режим и запрет хранилища не повод ронять вьювер
      return false;
    }
  });
  const closeHint = () => {
    setHintClosed(true);
    try {
      localStorage.setItem(hintKey, '1');
    } catch {
      /* переживём: подсказка просто вернётся при следующем открытии */
    }
  };

  return (
    <div className="flex w-full h-full">
      {/* 3D Scene area */}
      <div className="relative flex-1 min-w-0">
        <Scene currentUserId={userId} projectId={projectId} />

        {/* ═══ HUD: жёсткая сетка зон — панели в flex-колонках,
            перекрытия физически невозможны ═══ */}
        <div className="absolute inset-0 z-20 pointer-events-none p-3 flex gap-3">
          {/* ── Левая зона: тулбар + стек панелей ── */}
          <div className="flex gap-2 h-full min-h-0">
            <div className="pointer-events-auto self-start">
              <ViewerToolbar />
            </div>
            {/* Ширина колонки — по самой широкой панели внутри (рисование
                сети, w-64). Была w-56, и панель обрезалась по правому краю:
                вертикальная прокрутка режет и по горизонтали тоже. */}
            <div className="flex flex-col gap-2 min-h-0 w-64">
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 items-start pr-0.5">
                {utilityDrawMode && canEdit && <UtilityDrawPanel projectId={projectId} />}
                {fenceDrawMode && canEdit && <FenceDrawPanel projectId={projectId} />}
                <UtilityLayersPanel />
                {canEdit && <TerrainPanel projectId={projectId} centerLat={projectData?.centerLat} centerLng={projectData?.centerLng} />}
                {showPerf && <PerfPanel />}
                <SceneObjectsList />
              </div>
              <div className="pointer-events-auto self-start">
                <NavigationHelp />
              </div>
            </div>
          </div>

          {/* ── Центр: подсказки сверху, пресеты снизу ── */}
          <div className="flex-1 min-w-0 flex flex-col items-center justify-between py-1">
            <div className="pointer-events-auto flex flex-col items-center gap-1.5">
              {/* Рисование от руки держит камеру. Плашка обязана быть заметной
                  и обязана иметь выход: иначе человек, не знающий про Escape,
                  решит, что сцена сломалась. */}
              {mode === 'annotate' && annDrawMode === 'freehand' && (
                <div className="glass flex items-center gap-2 pl-3 pr-1.5 py-1.5 ring-2 ring-red-500/50">
                  <Brush size={16} className="text-red-400 shrink-0" />
                  <span className="text-xs text-strong">
                    Рисование от руки: камера заблокирована — <span className="text-muted">Escape</span> или крестик
                  </span>
                  <button
                    onClick={() => setAnnDrawMode('pin')}
                    title="Выйти из рисования от руки"
                    aria-label="Выйти из рисования от руки"
                    className="shrink-0 p-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
                  >
                    <X size={20} strokeWidth={3} />
                  </button>
                </div>
              )}

              {cameraView === 'first-person' && (
                <div className="glass-chip text-xs whitespace-nowrap">
                  <Footprints size={14} />
                  {fpPoint
                    ? (isTouch ? 'Проведите пальцем — осмотр · джойстик слева — ходьба' : 'Зажмите мышь — осмотр по сторонам · WASD — ходьба')
                    : 'Кликните точку на земле, куда «спуститься»'}
                </div>
              )}

              {/* Точка ставится двойным щелчком — одиночный вращает камеру.
                  Через три точки подсказка уходит: правило уже усвоено, а
                  надпись посреди экрана мешает смотреть на площадку. */}
              {drawingPoints && placedPoints < 3 && (
                <div className="glass-chip text-xs whitespace-nowrap">
                  <MousePointerClick size={14} />
                  {isTouch ? 'Двойное касание по земле — поставить точку' : 'Двойной клик по земле — поставить точку'}
                </div>
              )}
            </div>

            {/* Empty state */}
            {/* Подсказка первого шага. Раньше здесь всегда предлагалось
                загрузить модель — но начинать надо с импорта местности, и
                об этом не говорилось нигде. Теперь текст зависит от того,
                загружен ли ландшафт, а кнопка ведёт прямо к действию. */}
            {sceneData?.data.length === 0 && !hintClosed && (
              <div className="glass pointer-events-auto relative max-w-sm text-center px-6 py-5 select-none">
                <button
                  onClick={closeHint}
                  title="Скрыть подсказку"
                  aria-label="Скрыть подсказку"
                  className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-900/5 dark:hover:text-slate-200 dark:hover:bg-white/10 transition-colors"
                >
                  <X size={15} />
                </button>
                {!projectData?.terrainUrl ? (
                  <>
                    <div className="flex justify-center mb-3 text-vovplan-500"><Globe size={40} strokeWidth={1.4} /></div>
                    <p className="font-semibold text-strong mb-1.5">Начните с местности</p>
                    <p className="text-sm text-muted mb-4">
                      Обведите участок на карте — VOVPLAN подгрузит реальный рельеф,
                      здания, лес и водоёмы.
                    </p>
                    {canEdit && (
                      <button onClick={() => setMapImportOpen(true)} className="btn-primary text-sm">
                        Импортировать с карты
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-center mb-3 text-slate-400 dark:text-slate-500">
                      <Construction size={40} strokeWidth={1.4} />
                    </div>
                    <p className="font-semibold text-strong mb-1.5">Местность готова</p>
                    <p className="text-sm text-muted">
                      Теперь добавьте объекты: выберите модель в библиотеке справа
                      и разместите её на площадке.
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="pointer-events-auto flex flex-col items-center gap-2">
              {cameraView === 'first-person' ? (
                <button onClick={() => setCameraView('orbit')} className="btn-primary text-sm shadow-xl">
                  ↩ Назад к обзору
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <PresetsBar projectId={projectId} canEdit={canEdit} />
                  {canEdit && (
                    <button
                      onClick={capturePreview}
                      disabled={capturing}
                      title="Снять превью для карточки проекта"
                      className="glass-chip"
                    >
                      <Camera size={14} />
                      <span className="hidden sm:inline">
                        {capturing ? 'Снимок...' : previewSaved ? 'Готово' : 'Превью'}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Виртуальный джойстик ходьбы — только тач + режим первого лица */}
            {cameraView === 'first-person' && isTouch && (
              <div className="absolute left-4 bottom-4 pointer-events-none">
                <TouchJoystick />
              </div>
            )}
          </div>

          {/* ── Правая зона: присутствие, инфопанель, аннотации ── */}
          <div className="flex flex-col items-end gap-2 h-full min-h-0 w-fit">
            <div className="pointer-events-auto">
              <PresenceBar currentUserId={userId} />
            </div>
            {canEdit && isMobile && (
              <button
                onClick={() => setLibraryOpen(true)}
                className="pointer-events-auto w-11 h-11 rounded-full bg-vovplan-600 text-white text-xl shadow-xl flex items-center justify-center"
                title="Библиотека моделей"
              >
                <Package size={20} />
              </button>
            )}
            <div className="pointer-events-auto flex-1 min-h-0 overflow-y-auto flex flex-col items-end gap-2">
              <ObjectInfoPanel projectId={projectId} />
              <UtilityEditPanel projectId={projectId} />
              <AnnotationEditPanel projectId={projectId} />
            </div>
            <div className="pointer-events-auto">
              <AnnotationsList projectId={projectId} />
            </div>
          </div>
        </div>

        {/* Мобильный оверлей библиотеки моделей */}
        {canEdit && isMobile && libraryOpen && (
          <div className="absolute inset-0 z-40 flex">
            <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setLibraryOpen(false)} />
            <div className="relative h-full">
              <button
                onClick={() => setLibraryOpen(false)}
                className="absolute -left-3 top-3 z-50 w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-strong text-sm shadow-lg border border-white/10"
                title="Закрыть"
              >
                <X size={14} className="mx-auto" />
              </button>
              <ModelLibrary projectId={projectId} onPlaceObject={(m) => { setLibraryOpen(false); return handlePlaceObject(m); }} />
            </div>
          </div>
        )}
      </div>

      {/* Model Library (only for editors) — десктоп: постоянный сайдбар */}
      {canEdit && !isMobile && (
        <ModelLibrary projectId={projectId} onPlaceObject={handlePlaceObject} />
      )}
    </div>
  );
}
