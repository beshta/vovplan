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
/** «Красивый» шаг сетки: 1/2/5×10ⁿ так, чтобы линий было ~40–100 */
function niceStep(size: number): number {
  const target = size / 60;
  const pow = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= target) return pow * m;
  }
  return pow * 10;
}

function fmtMeters(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}км` : `${v}м`;
}

export default function SceneGrid({ size = 200 }: { size?: number }) {
  const { gridHelper, labels } = useMemo(() => {
    // Шаг адаптивный: 1 юнит = 1 метр, поэтому подписи всегда честные —
    // и на площадке 200м (шаг 5м), и на 3км (шаг 50м)
    const step = niceStep(size);
    const divisions = Math.round(size / step);
    const gridHelper = new THREE.GridHelper(size, divisions, 0x2a3a2a, 0x1a2a1a);
    gridHelper.position.y = 0.01; // slightly above terrain
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.12;

    // Подписи каждые 4 линии
    const labels: { pos: [number, number, number]; text: string }[] = [];
    const labelStep = step * 4;
    const half = size / 2;

    for (let x = labelStep; x <= half; x += labelStep) {
      labels.push({ pos: [x, 0.1, -half + step / 2], text: fmtMeters(x) });
      labels.push({ pos: [-x, 0.1, -half + step / 2], text: fmtMeters(-x) });
    }
    for (let z = labelStep; z <= half; z += labelStep) {
      labels.push({ pos: [-half + step / 2, 0.1, z], text: fmtMeters(z) });
      labels.push({ pos: [-half + step / 2, 0.1, -z], text: fmtMeters(-z) });
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
          distanceFactor={Math.max(30, size * 0.15)}
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
