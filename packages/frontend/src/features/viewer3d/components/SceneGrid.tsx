import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

/**
 * Coordinate grid + metric ruler.
 *
 * Renders a grid at y=0 with 10m major lines and 1m minor lines,
 * plus axis labels (X = East, Z = North) and distance markers.
 * The grid sits slightly above terrain to prevent z-fighting.
 */
export default function SceneGrid({ size = 200 }: { size?: number }) {
  // Create grid texture with labels every 10 meters
  const { gridHelper, labels } = useMemo(() => {
    // GridHelper: divisions = size/1 = 200 cells of 1m each
    // But we want major lines every 10m, minor every 1m
    const divisions = size; // 1m cells
    const gridHelper = new THREE.GridHelper(size, divisions, 0x2a3a2a, 0x1a2a1a);
    gridHelper.position.y = 0.01; // slightly above terrain
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.12;

    // Generate labels every 20 meters along X and Z axes
    const labels: { pos: [number, number, number]; text: string }[] = [];
    const step = 20;
    const half = size / 2;

    for (let x = -half; x <= half; x += step) {
      if (x === 0) continue;
      labels.push({ pos: [x, 0.1, -half + 2], text: `${x}м` });
    }
    for (let z = -half; z <= half; z += step) {
      if (z === 0) continue;
      labels.push({ pos: [-half + 2, 0.1, z], text: `${z}м` });
    }

    // Origin label
    labels.push({ pos: [0, 0.1, 0], text: '0,0' });

    return { gridHelper, labels };
  }, [size]);

  return (
    <group>
      {/* Grid */}
      <primitive object={gridHelper} />

      {/* Axis lines (X=red, Z=blue) */}
      <AxisLine axis="x" size={size} />
      <AxisLine axis="z" size={size} />

      {/* Distance labels */}
      {labels.map((label, i) => (
        <Html
          key={i}
          position={label.pos}
          center
          distanceFactor={30}
          zIndexRange={[10, 0]}
        >
          <div className="text-[10px] text-slate-200/70 bg-slate-900/50 rounded px-1 py-0.5 select-none pointer-events-none whitespace-nowrap">
            {label.text}
          </div>
        </Html>
      ))}
    </group>
  );
}

function AxisLine({ axis, size }: { axis: 'x' | 'z'; size: number }) {
  const half = size / 2;
  const color = axis === 'x' ? '#dc2626' : '#2563eb';

  const positions: [number, number, number][] = axis === 'x'
    ? [[-half, 0.02, 0], [half, 0.02, 0]]
    : [[0, 0.02, -half], [0, 0.02, half]];

  const geom = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(
      positions.map((p) => new THREE.Vector3(...p)),
    );
  }, [positions]);

  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} linewidth={2} />
    </line>
  );
}
