import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { ACESFilmicToneMapping } from 'three';
import Lighting from './Lighting';
import CameraRig from './CameraRig';
import Terrain from './Terrain';
import SceneObject from './SceneObject';
import { useViewerStore } from '../stores/viewerStore';
import { detectQuality } from '../utils/deviceProfiler';

/**
 * The R3F Canvas — 3D scene root.
 * Contains lighting, camera controls, terrain, and all scene objects.
 */
export default function Scene({ currentUserId }: { currentUserId: string }) {
  const quality = detectQuality();
  const objects = useViewerStore((s) => s.objects);
  const selectObject = useViewerStore((s) => s.selectObject);

  return (
    <Canvas
      shadows={quality.enableShadows ? 'soft' : false}
      dpr={quality.pixelRatio}
      gl={{
        antialias: !quality.isMobile,
        powerPreference: 'high-performance',
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
      }}
      camera={{ fov: 50, near: 0.1, far: 1000, position: [40, 45, 40] }}
      onPointerMissed={() => selectObject(null)}
    >
      {/* Sky background color */}
      <color attach="background" args={['#87a8d8']} />
      <fog attach="fog" args={['#87a8d8', 100, 400]} />

      <Suspense fallback={null}>
        <Lighting shadowMapSize={quality.shadowMapSize} />
        <CameraRig />
        <Terrain size={200} />

        {/* Render all scene objects */}
        {objects.map((obj) => (
          <SceneObject key={obj.id} data={obj} currentUserId={currentUserId} />
        ))}
      </Suspense>
    </Canvas>
  );
}
