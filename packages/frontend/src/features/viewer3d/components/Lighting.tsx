import { useRef } from 'react';
import * as THREE from 'three';

/**
 * Natural lighting: directional sun light + hemisphere sky/ground light.
 * Shadows use PCFSoftShadowMap for soft edges.
 *
 * The sun position can be animated or set to a fixed angle.
 * Default: 50° elevation, south-east azimuth — good shadow visibility.
 */
export default function Lighting({ shadowMapSize = 2048 }: { shadowMapSize?: number }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);

  // Fixed sun position — can be made dynamic (time-of-day) later
  const sunPosition: [number, number, number] = [80, 100, 40];

  return (
    <>
      {/* Ambient sky light — soft blue from above, warm from below */}
      <hemisphereLight
        args={['#b1d8ff', '#5a4a35', 0.6]}
      />

      {/* Sun — directional with shadows */}
      <directionalLight
        ref={sunRef}
        position={sunPosition}
        intensity={1.8}
        color="#fff4e6"
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-far={300}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={0.5}
        shadow-bias={-0.0005}
      />
    </>
  );
}
