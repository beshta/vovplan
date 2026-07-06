import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { AnnotationData } from '../types';

/**
 * Renders a single 3D annotation (arrow, line, freehand, or pin).
 * Drawn by Super Spectators, visible to all users.
 *
 * Hover shows a label with author + text.
 */
export default function Annotation3D({ data }: { data: AnnotationData }) {
  const [hovered, setHovered] = useState(false);

  const opacity = data.resolved ? 0.4 : 1.0;

  if (data.type === 'pin') return <PinAnnotation data={data} hovered={hovered} setHovered={setHovered} />;
  if (data.type === 'arrow') return <ArrowAnnotation points={data.points} color={data.color} opacity={opacity} data={data} hovered={hovered} setHovered={setHovered} />;
  if (data.type === 'freehand') return <FreehandAnnotation points={data.points} color={data.color} opacity={opacity} data={data} hovered={hovered} setHovered={setHovered} />;
  return <LineAnnotation points={data.points} color={data.color} opacity={opacity} data={data} hovered={hovered} setHovered={setHovered} />;
}

// ── Hover label (shared) ──────────────────────
function HoverLabel({ data, position }: { data: AnnotationData; position: [number, number, number] }) {
  return (
    <Html position={position} center distanceFactor={15} zIndexRange={[20, 0]}>
      <div className="bg-slate-900/95 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs whitespace-normal pointer-events-none">
        <div className="font-semibold text-vovplan-300">{data.authorName}</div>
        <div className="mt-0.5">{data.text}</div>
        {data.resolved && <div className="mt-1 text-green-400 text-[10px]">✓ Решено</div>}
      </div>
    </Html>
  );
}

// ── Pin: sphere marker at a point ─────────────
function PinAnnotation({ data, hovered, setHovered }: { data: AnnotationData; hovered: boolean; setHovered: (v: boolean) => void }) {
  const pos = data.points[0] ?? [0, 0, 0];
  const labelPos: [number, number, number] = [pos[0], pos[1] + 1, pos[2]];

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Pin sphere */}
      <mesh position={pos}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={data.color}
          emissive={data.color}
          emissiveIntensity={0.6}
          transparent={data.resolved}
          opacity={data.resolved ? 0.4 : 1}
        />
      </mesh>
      {/* Stick */}
      <mesh position={[pos[0], pos[1] - 0.5, pos[2]]}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
        <meshStandardMaterial color={data.color} transparent={data.resolved} opacity={data.resolved ? 0.4 : 1} />
      </mesh>

      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Arrow: line + cone head ───────────────────
function ArrowAnnotation({
  points,
  color,
  opacity,
  data,
  hovered,
  setHovered,
}: {
  points: [number, number, number][];
  color: string;
  opacity: number;
  data: AnnotationData;
  hovered: boolean;
  setHovered: (v: boolean) => void;
}) {
  const { lineGeom, conePos, coneRot } = useMemo(() => {
    const start = new THREE.Vector3(...points[0]);
    const end = new THREE.Vector3(...points[1]);
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);

    const dir = end.clone().sub(start).normalize();
    const conePos = end.toArray();

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const euler = new THREE.Euler().setFromQuaternion(quat);

    return { lineGeom: geom, conePos, coneRot: [euler.x, euler.y, euler.z] as [number, number, number] };
  }, [points]);

  const labelPos: [number, number, number] = [
    (points[0][0] + points[1][0]) / 2,
    (points[0][1] + points[1][1]) / 2 + 1.5,
    (points[0][2] + points[1][2]) / 2,
  ];

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <line>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      </line>
      <mesh position={conePos} rotation={coneRot}>
        <coneGeometry args={[0.3, 0.8, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} transparent opacity={opacity} />
      </mesh>

      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Simple line ───────────────────────────────
function LineAnnotation({
  points,
  color,
  opacity,
  data,
  hovered,
  setHovered,
}: {
  points: [number, number, number][];
  color: string;
  opacity: number;
  data: AnnotationData;
  hovered: boolean;
  setHovered: (v: boolean) => void;
}) {
  const geom = useMemo(() => {
    const verts = points.map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(verts);
  }, [points]);

  const labelPos: [number, number, number] = [
    points[Math.floor(points.length / 2)][0],
    points[Math.floor(points.length / 2)][1] + 1.5,
    points[Math.floor(points.length / 2)][2],
  ];

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <line>
        <primitive object={geom} attach="geometry" />
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      </line>

      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Freehand: smooth curve through points ─────
function FreehandAnnotation({
  points,
  color,
  opacity,
  data,
  hovered,
  setHovered,
}: {
  points: [number, number, number][];
  color: string;
  opacity: number;
  data: AnnotationData;
  hovered: boolean;
  setHovered: (v: boolean) => void;
}) {
  const geom = useMemo(() => {
    if (points.length < 2) return new THREE.BufferGeometry();
    const verts = points.map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(verts);
    const curvePoints = curve.getPoints(points.length * 4);
    return new THREE.BufferGeometry().setFromPoints(curvePoints);
  }, [points]);

  const midIdx = Math.floor(points.length / 2);
  const labelPos: [number, number, number] = [
    points[midIdx]?.[0] ?? 0,
    (points[midIdx]?.[1] ?? 0) + 1.5,
    points[midIdx]?.[2] ?? 0,
  ];

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <line>
        <primitive object={geom} attach="geometry" />
        <lineBasicMaterial color={color} transparent opacity={opacity} />
      </line>

      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}
