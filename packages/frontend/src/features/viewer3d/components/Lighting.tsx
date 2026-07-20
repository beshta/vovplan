import { useRef } from 'react';
import * as THREE from 'three';

/**
 * Natural lighting: directional sun light + hemisphere sky/ground light.
 * Shadows use PCFSoftShadowMap for soft edges.
 *
 * sceneSize — размер площадки в юнитах (метрах): shadow-камера и позиция
 * солнца масштабируются, чтобы тени покрывали всю сцену и на площадках
 * в несколько километров.
 */
export default function Lighting({
  shadowMapSize = 2048,
  sceneSize = 200,
}: {
  shadowMapSize?: number;
  sceneSize?: number;
}) {
  const sunRef = useRef<THREE.DirectionalLight>(null);

  const half = sceneSize * 0.65;
  const sunPosition: [number, number, number] = [sceneSize * 0.4, sceneSize * 0.5, sceneSize * 0.2];

  return (
    <>
      {/* Ambient sky light — soft blue from above, warm from below */}
      <hemisphereLight
        args={['#d0e8ff', '#aa9566', 2.0]}
      />

      {/* Sun — directional with shadows */}
      <directionalLight
        ref={sunRef}
        position={sunPosition}
        intensity={5.0}
        color="#fff4e6"
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-far={sceneSize * 2}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-bias={-0.0005}
      />
    </>
  );
}
