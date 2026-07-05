import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Terrain / ground mesh.
 *
 * Phase 2.2 will replace this with a real DEM-based heightmap.
 * For now: a large flat plane with grid texture for spatial reference.
 */
export default function Terrain({ size = 200 }: { size?: number }) {
  const gridTexture = useMemo(() => createGridTexture(size), [size]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[size, size, 1, 1]} />
      <meshStandardMaterial
        map={gridTexture}
        color="#5a7a5a"
        roughness={0.85}
        metalness={0}
      />
    </mesh>
  );
}

/** Procedural grid texture for spatial reference */
function createGridTexture(size: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Dark green base
  ctx.fillStyle = '#4a6a4a';
  ctx.fillRect(0, 0, 512, 512);

  // Grid lines every 64px (represents 10m in world space)
  ctx.strokeStyle = '#6a8a5a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  // Major lines every 256px
  ctx.strokeStyle = '#8aaa7a';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 256) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(size / 10, size / 10);
  return texture;
}
