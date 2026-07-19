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
import UtilityCreator from './UtilityCreator';
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
  const proceduralTerrain = useViewerStore((s) => s.proceduralTerrain);
  const annotations = useViewerStore((s) => s.annotations);
  const showAnnotations = useViewerStore((s) => s.showAnnotations);
  const mode = useViewerStore((s) => s.mode);
  const annDrawMode = (useViewerStore.getState() as any).annDrawMode ?? 'pin';
  const utilityDrawMode = (useViewerStore.getState() as any).utilityDrawMode;

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
      camera={{ fov: 50, near: 0.1, far: 1000, position: [50, 55, 50] }}
      onPointerMissed={() => selectObject(null)}
    >
      {/* Sky background color */}
      <color attach="background" args={['#a8c8e8']} />
      <fog attach="fog" args={['#a8c8e8', 120, 500]} />

      <Suspense fallback={null}>
        <Lighting shadowMapSize={quality.shadowMapSize} />
        <CameraRig />
        <TerrainManager
          size={200}
          heightmapUrl={terrainUrl}
          procedural={proceduralTerrain}
          xray={xrayMode}
        />

        {/* Coordinate grid + ruler */}
        <SceneGrid size={200} />

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
