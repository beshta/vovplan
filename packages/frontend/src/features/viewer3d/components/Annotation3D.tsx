import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import type { AnnotationData } from '../types';
import { useViewerStore } from '../stores/viewerStore';
import { stamp } from '../utils/stamp';
import { PIN_BALL, PIN_BALL_Y, PIN_DROP, PIN_RING, PIN_TOP } from '../utils/pinGeometry';

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
/**
 * Подпись при наведении — вдвое крупнее постоянной.
 *
 * Размер задаётся `distanceFactor`, а не шрифтами: он масштабирует всю
 * плашку целиком, поэтому пропорции остаются те же, что у постоянной.
 */
function HoverLabel({ data, position }: { data: AnnotationData; position: [number, number, number] }) {
  return (
    <Html position={position} center distanceFactor={30} zIndexRange={[20, 0]}>
      <div className="bg-slate-900/95 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs whitespace-normal pointer-events-none">
        <div className="font-semibold text-vovplan-300">{data.authorName}</div>
        <div className="text-[10px] text-slate-400">{stamp(data.createdAt)}</div>
        <div className="mt-0.5">{data.text}</div>
        {data.resolved && <div className="mt-1 text-emerald-400 text-[10px]">✓ Скрыта</div>}
      </div>
    </Html>
  );
}

/**
 * Постоянная подпись аннотации: кто поставил, когда и о чём.
 *
 * Раньше это показывалось только при наведении — то есть по аннотации надо
 * было попасть курсором, чтобы узнать, чья она и не устарела ли. На площадке
 * важно ровно обратное: кто и когда, видно сразу и у всех разом.
 */
function InfoLabel({ data, position }: { data: AnnotationData; position: [number, number, number] }) {
  return (
    <Html position={position} center distanceFactor={15} zIndexRange={[19, 0]}>
      <div
        className={`bg-slate-900/85 text-white rounded-lg px-2 py-1 shadow-lg max-w-[13rem] whitespace-normal text-center pointer-events-none ${
          data.resolved ? 'opacity-50' : ''
        }`}
      >
        <div className="text-[11px] font-semibold text-vovplan-300 leading-tight">{data.authorName}</div>
        <div className="text-[10px] text-slate-400 leading-tight">{stamp(data.createdAt)}</div>
        {data.text && <div className="text-[11px] leading-snug mt-0.5">{data.text}</div>}
      </div>
    </Html>
  );
}

/** Подпись висит всегда; при наведении её сменяет крупная и полная */
function Label({ data, position, hovered }: { data: AnnotationData; position: [number, number, number]; hovered: boolean }) {
  return hovered
    ? <HoverLabel data={data} position={position} />
    : <InfoLabel data={data} position={position} />;
}

/**
 * Заметка метки — прямоугольник, выезжающий из её верхушки вбок.
 *
 * Левый край сидит ровно на оси метки, поэтому заметка читается как её
 * часть, а не как отдельная плашка рядом. Вправо и вверх — потому что там
 * пусто: над остриём стоит сама капля, и текст, поставленный по центру,
 * ложился бы прямо на неё.
 */
function PinNote({ data, position, hovered }: {
  data: AnnotationData; position: [number, number, number]; hovered: boolean;
}) {
  // Выезд при появлении: заметка должна прочитываться как движение изнутри
  // метки, иначе она выглядит просто висящей рядом
  const [out, setOut] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOut(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Html
      position={position}
      distanceFactor={18}
      zIndexRange={[30, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="flex items-center -translate-y-1/2">
        {/* Черенок: то самое «выезжает и является её частью» */}
        <span className={`h-1 bg-slate-900/85 rounded-full transition-all duration-300 ${out ? 'w-4' : 'w-0'}`} />
        <div
          className={`rounded-lg bg-slate-900/90 text-white shadow-xl px-2.5 py-1.5 origin-left transition-all duration-300 ${
            out ? 'opacity-100 scale-100' : 'opacity-0 scale-x-0'
          } ${data.resolved ? 'opacity-60' : ''}`}
          style={{ width: hovered ? '17rem' : '11rem' }}
        >
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold text-vovplan-300 truncate">{data.authorName}</span>
            <span className="text-[9px] text-slate-400 shrink-0 ml-auto">{stamp(data.createdAt)}</span>
          </div>
          {data.text && (
            <div className={`text-[11px] leading-snug ${hovered ? 'whitespace-normal' : 'truncate'}`}>
              {data.text}
            </div>
          )}
          {data.resolved && <div className="text-emerald-400 text-[9px] mt-0.5">✓ Скрыта</div>}
        </div>
      </div>
    </Html>
  );
}

// ── Pin: кольцо на земле, капля остриём вниз, шар в раструбе ──
function PinAnnotation({ data, hovered, selected, hoverProps }: { data: AnnotationData; hovered: boolean; selected: boolean; hoverProps: any }) {
  const base = data.points[0] ?? [0, 0, 0]; // остриё капли — на земле
  const opacity = data.resolved ? 0.4 : 1;
  const transparent = opacity < 1;
  // Выделение и наведение поднимают метку, а не перестраивают её: форма
  // одна на все метки проекта
  const scale = selected ? 1.18 : hovered ? 1.06 : 1;
  const body = selected ? '#ffffff' : data.color;

  return (
    <group position={base} scale={scale} {...hoverProps}>
      {/* Кольцо: показывает, к какой точке земли относится метка */}
      <mesh geometry={PIN_RING} position={[0, 0.05, 0]} receiveShadow>
        <meshStandardMaterial
          color={body}
          emissive={data.color}
          emissiveIntensity={selected ? 0.6 : 0.25}
          roughness={0.45}
          metalness={0.1}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>

      {/* Капля. Двусторонняя: раструб головки открыт, и без изнанки сквозь
          него была бы видна пустота вместо стенки */}
      <mesh geometry={PIN_DROP} castShadow>
        <meshStandardMaterial
          color={body}
          emissive={data.color}
          emissiveIntensity={selected ? 0.55 : 0.2}
          roughness={0.4}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>

      {/* Шар в раструбе — светлый, как белый круг на знаке */}
      <mesh geometry={PIN_BALL} position={[0, PIN_BALL_Y, 0]} castShadow>
        <meshStandardMaterial
          color="#f8fafc"
          emissive={selected ? '#ffffff' : data.color}
          emissiveIntensity={selected ? 0.5 : 0.18}
          roughness={0.25}
          metalness={0.1}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>

      <PinNote data={data} position={[0, PIN_TOP + 0.18, 0]} hovered={hovered} />
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
      <Label data={data} position={labelPos} hovered={hovered} />
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
      <Label data={data} position={labelPos} hovered={hovered} />
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
      <Label data={data} position={labelPos} hovered={hovered} />
    </group>
  );
}
