import { useMemo } from 'react';
import * as THREE from 'three';
import type { AnnotationData } from '../types';

/**
 * Renders a single 3D annotation (arrow or line).
 * Drawn by Super Spectators, visible to all users.
 */
export default function Annotation3D({ data }: { data: AnnotationData }) {
  if (data.type === 'arrow') return <ArrowAnnotation points={data.points} color={data.color} />;
  return <LineAnnotation points={data.points} color={data.color} />;
}

/** Arrow: line + cone head */
function ArrowAnnotation({ points, color }: { points: [number, number, number][]; color: string }) {
  const { lineGeom, conePos, coneRot } = useMemo(() => {
    const start = new THREE.Vector3(...points[0]);
    const end = new THREE.Vector3(...points[1]);
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);

    // Cone at the end, pointing from start to end
    const dir = end.clone().sub(start).normalize();
    const conePos = end.toArray();

    // Rotation: align cone Y-axis with direction
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const euler = new THREE.Euler().setFromQuaternion(quat);

    return { lineGeom: geom, conePos, coneRot: [euler.x, euler.y, euler.z] as [number, number, number] };
  }, [points]);

  return (
    <group>
      <line>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial color={color} linewidth={3} />
      </line>
      <mesh position={conePos} rotation={coneRot}>
        <coneGeometry args={[0.3, 0.8, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

/** Simple line */
function LineAnnotation({ points, color }: { points: [number, number, number][]; color: string }) {
  const geom = useMemo(() => {
    const verts = points.map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(verts);
  }, [points]);

  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} linewidth={2} />
    </line>
  );
}
