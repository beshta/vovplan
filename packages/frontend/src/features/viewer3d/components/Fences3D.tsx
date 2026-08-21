import { useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import { layoutFence, FENCE_TYPES } from '../utils/fenceLayout';
import type { FenceData } from '../types';

/**
 * Ограждения площадки.
 *
 * Забор — это одна секция, повторённая по периметру: на 200 метрах их около
 * восьмидесяти. Каждая деталь каждой секции — копия одного единичного куба,
 * поэтому весь забор любой длины уходит в видеокарту одним вызовом отрисовки
 * (у решётки — двумя, полотно рисуется отдельной плоскостью).
 */
export default function Fences3D() {
  const fences = useViewerStore((s) => s.fences);
  const showFences = useViewerStore((s) => s.showFences);
  const selectedFenceId = useViewerStore((s) => s.selectedFenceId);
  const selectFence = useViewerStore((s) => s.selectFence);

  if (!showFences) return null;

  return (
    <group>
      {fences.map((fence) => (
        <FenceRun
          key={fence.id}
          data={fence}
          selected={selectedFenceId === fence.id}
          onSelect={() => selectFence(fence.id)}
        />
      ))}
    </group>
  );
}

/** Единичный куб и плоскость — общие на все ограждения проекта */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

/**
 * Одно ограждение целиком. Вынесено наружу, чтобы черновик рисовался тем же
 * кодом, что и сохранённое: иначе «как будет» и «как стало» расходятся, и
 * человек узнаёт об этом уже после сохранения.
 */
export function FenceRun({
  data,
  selected = false,
  onSelect,
}: {
  data: FenceData;
  selected?: boolean;
  /** Без обработчика ограждение не ловит клики — так рисуют черновик поверх земли */
  onSelect?: () => void;
}) {
  const groundSampler = useViewerStore((s) => s.groundSampler);
  const spec = FENCE_TYPES[data.type];
  const height = data.height ?? spec.height;

  const spans = useMemo(
    () => layoutFence(data.geometry, {
      sectionLength: spec.sectionLength,
      height,
      closed: data.closed,
      ground: groundSampler ?? undefined,
    }),
    [data.geometry, data.closed, height, spec.sectionLength, groundSampler],
  );

  /*
   * Детали строятся сразу в нужную высоту, а не подгоняются масштабом.
   *
   * Раньше секция собиралась в типовой размер и сплющивалась матрицей под
   * фактический: при нетиповой высоте вместе с панелью растягивались прутки
   * и рёбра, а на уклоне — вся секция целиком. Секция бывает только своего
   * размера, поэтому размер и задаётся при сборке.
   */
  const parts = useMemo(() => spec.parts(spec.sectionLength, height), [spec, height]);

  const boxRef = useRef<THREE.InstancedMesh>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const boxes = boxRef.current;
    if (!boxes) return;

    const span = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const full = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const noScale = new THREE.Vector3(1, 1, 1);

    let i = 0;
    spans.forEach((s, si) => {
      // Пролёт — только поворот и перенос: все секции одинаковые
      quat.setFromAxisAngle(axis, s.yaw);
      pos.set(s.center[0], s.center[1], s.center[2]);
      span.compose(pos, quat, noScale);

      parts.forEach((p) => {
        part.makeScale(p.size[0], p.size[1], p.size[2]);
        part.setPosition(p.at[0], p.at[1], p.at[2]);
        full.multiplyMatrices(span, part);
        boxes.setMatrixAt(i++, full);
      });

      if (meshRef.current) {
        // Полотно — одна плоскость во всю секцию, по её середине
        part.makeScale(spec.sectionLength, height, 1);
        part.setPosition(0, height / 2, 0);
        full.multiplyMatrices(span, part);
        meshRef.current.setMatrixAt(si, full);
      }
    });

    boxes.count = i;
    boxes.instanceMatrix.needsUpdate = true;
    // Без пересчёта границ копии считаются лежащими в начале координат и
    // пропадают, стоит отвести камеру
    boxes.computeBoundingSphere();

    if (meshRef.current) {
      meshRef.current.count = spans.length;
      meshRef.current.instanceMatrix.needsUpdate = true;
      meshRef.current.computeBoundingSphere();
    }
  }, [spans, parts, spec.sectionLength, height]);

  const meshTexture = useMemo(
    () => (spec.mesh ? buildMeshTexture(spec.sectionLength, height) : null),
    [spec.mesh, spec.sectionLength, height],
  );
  useLayoutEffect(() => () => meshTexture?.dispose(), [meshTexture]);

  if (spans.length === 0) return null;

  const emissive = selected ? '#ffffff' : '#000000';
  const pointer = onSelect
    ? {
        onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(); },
        onPointerOver: (e: { stopPropagation: () => void }) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; },
        onPointerOut: () => { document.body.style.cursor = ''; },
      }
    : {};

  return (
    <group>
      <instancedMesh
        ref={boxRef}
        args={[UNIT_BOX, undefined, spans.length * parts.length]}
        castShadow
        receiveShadow
        {...pointer}
      >
        <meshStandardMaterial
          color={spec.color}
          emissive={emissive}
          emissiveIntensity={selected ? 0.35 : 0}
          roughness={data.type === 'CONCRETE' ? 0.95 : 0.5}
          metalness={data.type === 'CONCRETE' ? 0 : 0.6}
        />
      </instancedMesh>

      {meshTexture && (
        <instancedMesh
          ref={meshRef}
          args={[UNIT_PLANE, undefined, spans.length]}
          castShadow
          {...pointer}
        >
          <meshStandardMaterial
            color={spec.color}
            emissive={emissive}
            emissiveIntensity={selected ? 0.35 : 0}
            map={meshTexture}
            alphaMap={meshTexture}
            // Прозрачность порогом, а не смешиванием: полупрозрачные грани
            // пришлось бы сортировать по глубине, а их здесь восемьдесят
            alphaTest={0.4}
            side={THREE.DoubleSide}
            roughness={0.55}
            metalness={0.5}
          />
        </instancedMesh>
      )}
    </group>
  );
}

/** Ячейка сварной сетки: 50 мм по горизонтали, 200 мм по вертикали */
const CELL_W = 0.05;
const CELL_H = 0.2;

/**
 * Полотно сварной сетки 50×200 мм — повторяющаяся ячейка, а не рисунок всей
 * панели: так текстура весит килобайт и остаётся резкой на любом размере.
 *
 * Число повторов считается от габарита секции, а не задано числом: ячейка
 * сетки — величина физическая, и на панели вдвое выше её должно быть вдвое
 * больше, а не вдвое более вытянутых.
 */
function buildMeshTexture(sectionLength: number, height: number): THREE.Texture {
  const cellW = 16;
  const cellH = 64;
  const canvas = document.createElement('canvas');
  canvas.width = cellW;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, cellW, cellH);
  ctx.fillStyle = '#ffffff';
  // Пруток около 5 мм: два пикселя из шестнадцати на 50 мм ячейки
  ctx.fillRect(0, 0, 2, cellH);
  ctx.fillRect(0, 0, cellW, 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    Math.max(1, Math.round(sectionLength / CELL_W)),
    Math.max(1, Math.round(height / CELL_H)),
  );
  texture.anisotropy = 4;
  return texture;
}
