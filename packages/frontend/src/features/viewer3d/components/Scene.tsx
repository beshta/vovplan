import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Suspense } from 'react';
import { ACESFilmicToneMapping } from 'three';
import Lighting from './Lighting';
import CameraRig from './CameraRig';
import TerrainManager from './TerrainManager';
import SceneObject from './SceneObject';
import UtilityNetworks3D from './UtilityNetworks3D';
import Annotation3D from './Annotation3D';
import AnnotationTool from './AnnotationTool';
import SceneGrid from './SceneGrid';
import BuildingsLayer from './BuildingsLayer';
import NatureLayer from './NatureLayer';
import PerfProbe from './PerfProbe';
import UtilityCreator from './UtilityCreator';
import Fences3D from './Fences3D';
import FenceCreator from './FenceCreator';
import FirstPersonView from './FirstPersonView';
import PeerLayer from '../../collaboration/PeerLayer';
import { useViewerStore } from '../stores/viewerStore';
import MeasureTape from './MeasureTape';
import { detectQuality } from '../utils/deviceProfiler';

/**
 * The R3F Canvas — 3D scene root.
 * Contains lighting, camera controls, terrain, and all scene objects.
 */
export default function Scene({ currentUserId, projectId, shared = false }: { currentUserId: string; projectId: string; shared?: boolean }) {
  const quality = detectQuality();
  const objects = useViewerStore((s) => s.objects);
  const selectObject = useViewerStore((s) => s.selectObject);
  const xrayMode = useViewerStore((s) => s.xrayMode);
  const terrainUrl = useViewerStore((s) => s.terrainUrl);
  const terrainMeta = useViewerStore((s) => s.terrainMeta);
  const proceduralTerrain = useViewerStore((s) => s.proceduralTerrain);
  const annotations = useViewerStore((s) => s.annotations);
  const showAnnotations = useViewerStore((s) => s.showAnnotations);
  const mode = useViewerStore((s) => s.mode);
  // Реактивные подписки: раньше здесь был нереактивный getState(),
  // из-за чего включение инструментов не перерисовывало сцену
  const annDrawMode = useViewerStore((s) => s.annDrawMode);
  const utilityDrawMode = useViewerStore((s) => s.utilityDrawMode);
  const fenceDrawMode = useViewerStore((s) => s.fenceDrawMode);
  const cameraView = useViewerStore((s) => s.cameraView);
  const fpPoint = useViewerStore((s) => s.fpPoint);
  const setFpPoint = useViewerStore((s) => s.setFpPoint);
  const measureMode = useViewerStore((s) => s.measureMode);
  // Подписка нужна реактивная: от неё зависит, вешать ли обработчики на
  // рельеф, а значит — участвует ли он в рейкасте вообще
  const groundHandlers = useViewerStore((s) => s.groundHandlers);

  /** Нужна ли точка на земле прямо сейчас (рисование или выбор точки спуска) */
  const groundPicking = !!groundHandlers || measureMode || (cameraView === 'first-person' && !fpPoint);

  const groundEvents = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];
      if (cameraView === 'first-person' && !fpPoint) {
        e.stopPropagation();
        setFpPoint(pt);
        return;
      }
      /*
       * Дальше одиночный щелчок не трогаем: он занят вращением камеры и
       * выделением. Пока точки ставились им, каждый промах мимо орбиты
       * дорисовывал лишнюю точку в забор или трассу.
       */
    },
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
      const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];
      const state = useViewerStore.getState();
      // Рулетка идёт первой: пока мерим, щелчок ничего другого не делает
      if (state.measureMode) {
        e.stopPropagation();
        state.addMeasurePoint(pt);
        state.notePlacedPoint();
        return;
      }
      if (!state.groundHandlers?.onPlace) return;
      e.stopPropagation();
      state.groundHandlers.onPlace(pt);
      state.notePlacedPoint();
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const h = useViewerStore.getState().groundHandlers;
      if (h?.onDown) {
        e.stopPropagation();
        h.onDown([e.point.x, e.point.y, e.point.z]);
      }
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      useViewerStore.getState().groundHandlers?.onMove?.([e.point.x, e.point.y, e.point.z]);
    },
    onPointerUp: () => {
      useViewerStore.getState().groundHandlers?.onUp?.();
    },
  };

  // Масштаб 1:1 для реального ландшафта: размер сцены = размер площадки в метрах
  const sceneSize = terrainMeta ? Math.max(terrainMeta.widthM, terrainMeta.heightM) : 200;

  return (
    <Canvas
      shadows={quality.enableShadows ? 'soft' : false}
      dpr={quality.pixelRatio}
      gl={{
        antialias: !quality.isMobile,
        powerPreference: 'high-performance',
        // Нужен для снимка превью: без него toBlob отдаёт пустой кадр,
        // потому что буфер очищается сразу после отрисовки
        preserveDrawingBuffer: true,
        toneMapping: ACESFilmicToneMapping,
        // 1.8 пересвечивало схему-карту (светлые тайлы OSM уходили в белое)
        toneMappingExposure: 1.05,
      }}
      camera={{ fov: 50, near: 0.5, far: Math.max(100_000, sceneSize * 50), position: [50, 55, 50] }}
      onPointerMissed={() => {
        selectObject(null);
        useViewerStore.getState().selectUtility(null);
        useViewerStore.getState().selectAnnotation(null);
        useViewerStore.getState().selectFence(null);
      }}
    >
      {/* Sky background color */}
      <color attach="background" args={['#a8c8e8']} />
      {/* Тумана нет: он «съедал» дальний край площадки и читался как обрезка
          сцены по дальности. Дальняя плоскость отодвинута — ландшафт виден
          целиком с любой дистанции. */}

      <MeasureTape />
      <Suspense fallback={null}>
        <PerfProbe />
        <Lighting shadowMapSize={quality.shadowMapSize} sceneSize={sceneSize} />
        <CameraRig />
        {/* Группа-приёмник кликов по рельефу: R3F-события всплывают от
            меша террейна, e.point — точное 3D-попадание (работает и на
            холмах, в отличие от прежних плоских «планов-ловушек»).

            Обработчики вешаются ТОЛЬКО когда точка на земле реально нужна —
            при рисовании сетей/аннотаций или выборе точки спуска в режим от
            первого лица. Иначе R3F на каждое движение мыши считал пересечение
            луча с мешем рельефа (до 820 тыс. треугольников перебором): в
            статике сцена шла 144 кадра/с, а при вращении падала до 12.

            Группа при этом одна и та же в обоих состояниях — меняются только
            пропсы. Если подменять саму ветку дерева, рельеф перемонтируется и
            геометрия на 820 тыс. вершин соберётся заново при каждом включении
            инструмента. */}
        <group {...(groundPicking ? groundEvents : {})}>
          <TerrainManager
            size={200}
            heightmapUrl={terrainUrl}
            meta={terrainMeta}
            procedural={proceduralTerrain}
            xray={xrayMode}
          />
        </group>

        {/* Coordinate grid + ruler */}
        <SceneGrid size={sceneSize} />

        {/* Здания OSM (только для импортированного реального ландшафта) */}
        {terrainMeta?.buildingsUrl && <BuildingsLayer meta={terrainMeta} />}

        {/* Природа OSM: лес схематичными деревьями + водоёмы на своих отметках */}
        {terrainMeta?.natureUrl && terrainUrl && <NatureLayer meta={terrainMeta} />}

        {/* Engineering utility networks */}
        <UtilityNetworks3D />

        {/* Utility creator (when in utility-draw mode) — только 3D-превью/клики */}
        {utilityDrawMode && <UtilityCreator />}

        {/* Ограждения площадки + постановка нового */}
        <Fences3D />
        {fenceDrawMode && <FenceCreator />}

        {/* 3D Annotations (arrows, lines, pins) */}
        {showAnnotations && annotations.map((ann) => (
          <Annotation3D key={ann.id} data={ann} />
        ))}

        {/* Annotation drawing tool */}
        {mode === 'annotate' && (
          <AnnotationTool
            projectId={projectId}
            drawMode={annDrawMode}
            onFinished={() => {}}
          />
        )}

        {/* First-person: спуск камеры к выбранной точке (клик ловит группа террейна) */}
        {cameraView === 'first-person' && <FirstPersonView targetPoint={fpPoint} />}

        {/* Render all scene objects */}
        {objects.map((obj) => (
          <SceneObject key={obj.id} data={obj} currentUserId={currentUserId} projectId={projectId} />
        ))}

        {/* Real-time collaboration: peer cursors + local cursor emit.
            В публичном shared-режиме сокета нет — слой отключён. */}
        {!shared && <PeerLayer projectId={projectId} currentUserId={currentUserId} />}
      </Suspense>
    </Canvas>
  );
}
