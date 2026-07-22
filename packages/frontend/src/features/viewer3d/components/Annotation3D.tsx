import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { AnnotationData } from '../types';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Renders a single 3D annotation (arrow, line, freehand, or pin).
 * Толщина линий — реальная (drei <Line> в мировых единицах), в отличие
 * от нативного <line>, который в WebGL всегда 1px.
 * Клик по аннотации → выбор (открывает редактор). Hover — подпись.
 */
export default function Annotation3D({ data }: { data: AnnotationData }) {
  const [hovered, setHovered] = useState(false);
  const selectAnnotation = useViewerStore((s) => s.selectAnnotation);
  const selectedId = useViewerStore((s) => s.selectedAnnotationId);
  const selected = selectedId === data.id;

  const opacity = data.resolved ? 0.4 : 1.0;
  const width = data.width ?? 0.4;
  const onSelect = (e: { stopPropagation: () => void }) => { e.stopPropagation(); selectAnnotation(data.id); };
  const hoverProps = {
    onPointerOver: (e: any) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { setHovered(false); document.body.style.cursor = ''; },
    onClick: onSelect,
  };

  if (data.type === 'pin') return <PinAnnotation data={data} hovered={hovered} selected={selected} hoverProps={hoverProps} />;
  if (data.type === 'arrow') return <ArrowAnnotation data={data} opacity={opacity} width={width} hovered={hovered} selected={selected} hoverProps={hoverProps} />;
  if (data.type === 'freehand') return <FreehandAnnotation data={data} opacity={opacity} width={width} hovered={hovered} selected={selected} hoverProps={hoverProps} />;
  return <LineAnnotation data={data} opacity={opacity} width={width} hovered={hovered} selected={selected} hoverProps={hoverProps} />;
}

// ── Hover label (shared) ──────────────────────
function HoverLabel({ data, position }: { data: AnnotationData; position: [number, number, number] }) {
  return (
    <Html position={position} center distanceFactor={15} zIndexRange={[20, 0]}>
      <div className="bg-slate-900/95 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs whitespace-normal pointer-events-none">
        <div className="font-semibold text-vovplan-300">{data.authorName}</div>
        <div className="mt-0.5">{data.text}</div>
        {data.resolved && <div className="mt-1 text-emerald-400 text-[10px]">✓ Скрыта</div>}
      </div>
    </Html>
  );
}

// ── Одна наклонная «ножка» буквы V (цилиндр между двумя точками) ──
function Leg({ from, to, radius, color, opacity }: {
  from: [number, number, number]; to: [number, number, number];
  radius: number; color: string; opacity: number;
}) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const length = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: mid.toArray() as [number, number, number], quat: q.toArray() as [number, number, number, number], len: length };
  }, [from, to]);

  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[radius, radius, len, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.5} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

// ── Pin: метка-«V» с шариком в развилке (фирменный знак VOVPLAN) ──
function PinAnnotation({ data, hovered, selected, hoverProps }: { data: AnnotationData; hovered: boolean; selected: boolean; hoverProps: any }) {
  const base = data.points[0] ?? [0, 0, 0]; // острие «V» — на земле
  const H = selected ? 2.6 : 2.2;           // высота буквы
  const spread = 0.75;                       // разброс верхних концов ножек
  const legR = 0.09;

  const apex: [number, number, number] = [base[0], base[1], base[2]];
  const topL: [number, number, number] = [base[0] - spread, base[1] + H, base[2]];
  const topR: [number, number, number] = [base[0] + spread, base[1] + H, base[2]];
  const ballPos: [number, number, number] = [base[0], base[1] + H * 0.6, base[2]];
  const labelPos: [number, number, number] = [base[0], base[1] + H + 0.6, base[2]];

  const legColor = selected ? '#ffffff' : data.color;
  const opacity = data.resolved ? 0.4 : 1;
  const ballR = selected ? 0.42 : 0.34;

  return (
    <group {...hoverProps}>
      {/* Две ножки буквы V, сходятся к острию на земле */}
      <Leg from={apex} to={topL} radius={legR} color={legColor} opacity={opacity} />
      <Leg from={apex} to={topR} radius={legR} color={legColor} opacity={opacity} />
      {/* Шарик в развилке между ножками */}
      <mesh position={ballPos} castShadow>
        <sphereGeometry args={[ballR, 20, 20]} />
        <meshStandardMaterial
          color={selected ? '#ffffff' : data.color}
          emissive={data.color}
          emissiveIntensity={selected ? 1 : 0.7}
          roughness={0.3}
          transparent={data.resolved}
          opacity={opacity}
        />
      </mesh>
      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Arrow: line + cone head ───────────────────
function ArrowAnnotation({ data, opacity, width, hovered, selected, hoverProps }: { data: AnnotationData; opacity: number; width: number; hovered: boolean; selected: boolean; hoverProps: any }) {
  const points = data.points;
  const { conePos, coneRot } = useMemo(() => {
    const start = new THREE.Vector3(...points[0]);
    const end = new THREE.Vector3(...points[1]);
    const dir = end.clone().sub(start).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const euler = new THREE.Euler().setFromQuaternion(quat);
    return { conePos: end.toArray() as [number, number, number], coneRot: [euler.x, euler.y, euler.z] as [number, number, number] };
  }, [points]);

  const labelPos: [number, number, number] = [
    (points[0][0] + points[1][0]) / 2,
    (points[0][1] + points[1][1]) / 2 + 1.5,
    (points[0][2] + points[1][2]) / 2,
  ];

  return (
    <group {...hoverProps}>
      <Line points={points} color={selected ? '#ffffff' : data.color} lineWidth={width} worldUnits transparent opacity={opacity} />
      <mesh position={conePos} rotation={coneRot}>
        <coneGeometry args={[Math.max(width * 0.8, 0.3), Math.max(width * 2, 0.8), 12]} />
        <meshStandardMaterial color={data.color} emissive={data.color} emissiveIntensity={selected ? 0.9 : 0.5} transparent opacity={opacity} />
      </mesh>
      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Simple polyline ───────────────────────────
function LineAnnotation({ data, opacity, width, hovered, selected, hoverProps }: { data: AnnotationData; opacity: number; width: number; hovered: boolean; selected: boolean; hoverProps: any }) {
  const mid = data.points[Math.floor(data.points.length / 2)];
  const labelPos: [number, number, number] = [mid[0], mid[1] + 1.5, mid[2]];
  return (
    <group {...hoverProps}>
      <Line points={data.points} color={selected ? '#ffffff' : data.color} lineWidth={width} worldUnits transparent opacity={opacity} />
      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}

// ── Freehand: smooth curve through points ─────
function FreehandAnnotation({ data, opacity, width, hovered, selected, hoverProps }: { data: AnnotationData; opacity: number; width: number; hovered: boolean; selected: boolean; hoverProps: any }) {
  const points = data.points;
  const curvePoints = useMemo(() => {
    if (points.length < 2) return points;
    const verts = points.map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(verts);
    return curve.getPoints(points.length * 4).map((v) => [v.x, v.y, v.z] as [number, number, number]);
  }, [points]);

  const midIdx = Math.floor(points.length / 2);
  const labelPos: [number, number, number] = [
    points[midIdx]?.[0] ?? 0,
    (points[midIdx]?.[1] ?? 0) + 1.5,
    points[midIdx]?.[2] ?? 0,
  ];

  if (curvePoints.length < 2) return null;
  return (
    <group {...hoverProps}>
      <Line points={curvePoints} color={selected ? '#ffffff' : data.color} lineWidth={width} worldUnits transparent opacity={opacity} />
      {hovered && <HoverLabel data={data} position={labelPos} />}
    </group>
  );
}
