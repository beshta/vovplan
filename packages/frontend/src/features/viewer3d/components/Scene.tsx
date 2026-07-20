import { Canvas } from '@react-three/fiber';
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
import UtilityCreator from './UtilityCreator';
import FirstPersonView from './FirstPersonView';
import PeerLayer from '../../collaboration/PeerLayer';
import { useViewerStore } from '../stores/viewerStore';
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
  const cameraView = useViewerStore((s) => s.cameraView);
  const fpPoint = useViewerStore((s) => s.fpPoint);
  const setFpPoint = useViewerStore((s) => s.setFpPoint);

  // Масштаб 1:1 для реального ландшафта: размер сцены = размер площадки в метрах
  const sceneSize = terrainMeta ? Math.max(terrainMeta.widthM, terrainMeta.heightM) : 200;

  return (
    <Canvas
      shadows={quality.enableShadows ? 'soft' : false}
      dpr={quality.pixelRatio}
      gl={{
        antialias: !quality.isMobile,
        powerPreference: 'high-performance',
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.8,
      }}
      camera={{ fov: 50, near: 0.1, far: Math.max(1000, sceneSize * 6), position: [50, 55, 50] }}
      onPointerMissed={() => selectObject(null)}
    >
      {/* Sky background color */}
      <color attach="background" args={['#a8c8e8']} />
      {/* Дымка только у горизонта: ближе 300 юнитов сцена полностью чистая
          (при 120 туман съедал дальний край 200-юнитного ландшафта) */}
      <fog attach="fog" args={['#a8c8e8', sceneSize * 1.5, sceneSize * 4.5]} />

      <Suspense fallback={null}>
        <Lighting shadowMapSize={quality.shadowMapSize} sceneSize={sceneSize} />
        <CameraRig />
        {/* Группа-приёмник кликов по рельефу: R3F-события всплывают от
            меша террейна, e.point — точное 3D-попадание (работает и на
            холмах, в отличие от прежних плоских «планов-ловушек») */}
        <group
          onClick={(e) => {
            const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];
            if (cameraView === 'first-person' && !fpPoint) {
              e.stopPropagation();
              setFpPoint(pt);
              return;
            }
            const h = useViewerStore.getState().groundHandlers;
            if (h?.onClick) {
              e.stopPropagation();
              h.onClick(pt);
            }
          }}
          onPointerDown={(e) => {
            const h = useViewerStore.getState().groundHandlers;
            if (h?.onDown) {
              e.stopPropagation();
              h.onDown([e.point.x, e.point.y, e.point.z]);
            }
          }}
          onPointerMove={(e) => {
            const h = useViewerStore.getState().groundHandlers;
            h?.onMove?.([e.point.x, e.point.y, e.point.z]);
          }}
          onPointerUp={() => {
            useViewerStore.getState().groundHandlers?.onUp?.();
          }}
        >
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

        {/* Engineering utility networks */}
        <UtilityNetworks3D />

        {/* Utility creator (when in utility-draw mode) */}
        {utilityDrawMode && (
          <UtilityCreator projectId={projectId} />
        )}

        {/* 3D Annotations (arrows, lines, pins) */}
        {showAnnotations && annotations.map((ann) => (
          <Annotation3D key={ann.id} data={ann} />
        ))}

        {/* Annotation drawing tool */}
        {mode === 'annotate' && (
          <AnnotationTool
            projectId={projectId}
            drawMode={annDrawMode}
            color="#ef4444"
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
