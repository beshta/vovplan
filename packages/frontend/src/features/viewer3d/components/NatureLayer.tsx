import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { imageToData } from './DemTerrain';
import { useViewerStore } from '../stores/viewerStore';
import { detectQuality } from '../utils/deviceProfiler';
import type { TerrainMeta } from '../../../shared/api';

type LeafKind = 'needle' | 'broad' | 'mixed';

interface ForestArea {
  p: [number, number][]; // контур, локальные метры (x — восток, z — юг)
  leaf: LeafKind;
}
interface WaterArea {
  p: [number, number][];
  level: number;          // уровень воды над minElev, м
  /** Отметки по вершинам — у сегментов рек (уклон вдоль русла) */
  levels?: number[];
}

/** Одно дерево на N м² леса. Реже — пусто, чаще — просадка FPS на больших массивах */
const AREA_PER_TREE = 260;
/** Потолок числа деревьев (десктоп / слабое устройство) */
const MAX_TREES = 12_000;
const MAX_TREES_LOW = 3_000;

// ── Геометрия ──────────────────────────────────

/** Ray casting: точка внутри полигона */
function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(a / 2);
}

/** Детерминированный ГПСЧ — расстановка деревьев не «прыгает» между рендерами */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Природа из OSM: массивы леса схематичными low-poly деревьями (ёлки для
 * хвойного, «кругляши» для лиственного) и водоёмы горизонтальными плоскостями
 * на реальной геодезической отметке.
 *
 * Деревья рисуются двумя InstancedMesh (ствол + крона на тип листвы) —
 * тысячи деревьев укладываются в единицы draw call.
 */
export default function NatureLayer({
  meta,
  heightmapUrl,
}: {
  meta: TerrainMeta;
  heightmapUrl: string;
}) {
  const showNature = useViewerStore((s) => s.showNature);
  const xray = useViewerStore((s) => s.xrayMode);
  const [nature, setNature] = useState<{ forests: ForestArea[]; water: WaterArea[] } | null>(null);
  const heightTex = useLoader(THREE.TextureLoader, heightmapUrl);

  useEffect(() => {
    if (!meta.natureUrl) return;
    let cancelled = false;
    fetch(meta.natureUrl)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setNature({ forests: json.forests ?? [], water: json.water ?? [] });
      })
      .catch(() => setNature({ forests: [], water: [] }));
    return () => { cancelled = true; };
  }, [meta.natureUrl]);

  /**
   * Высота рельефа (м над minElev) в точке локальных координат.
   * Билинейная интерполяция — ровно та же, что в DemTerrain при смещении
   * вершин: с ближайшим пикселем деревья на склонах висели бы над землёй
   * или уходили в неё.
   */
  const elevAt = useMemo(() => {
    const hm = imageToData(heightTex.image as HTMLImageElement);
    const is16 = meta.encoding === 'rg16';
    const range = Math.max(meta.maxElev - meta.minElev, 1);

    const sample = (px: number, py: number) => {
      const idx = (py * hm.width + px) * 4;
      return is16 ? (hm.data[idx] * 256 + hm.data[idx + 1]) / 65535 : hm.data[idx] / 255;
    };

    return (x: number, z: number): number => {
      const u = Math.min(hm.width - 1, Math.max(0, (x / meta.widthM + 0.5) * (hm.width - 1)));
      const v = Math.min(hm.height - 1, Math.max(0, (z / meta.heightM + 0.5) * (hm.height - 1)));
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, hm.width - 1);
      const y1 = Math.min(y0 + 1, hm.height - 1);
      const fx = u - x0;
      const fy = v - y0;
      const top = sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx;
      const bot = sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx;
      return (top * (1 - fy) + bot * fy) * range;
    };
  }, [heightTex, meta]);

  // ── Деревья: детерминированная расстановка внутри контуров леса ──
  const perimeter = meta.polygon && meta.polygon.length >= 3 ? meta.polygon : null;

  const trees = useMemo(() => {
    if (!nature || nature.forests.length === 0) return null;
    const cap = detectQuality().isMobile ? MAX_TREES_LOW : MAX_TREES;

    const needle: THREE.Matrix4[] = [];
    const broad: THREE.Matrix4[] = [];
    const rnd = mulberry32(1337);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();

    for (const f of nature.forests) {
      if (needle.length + broad.length >= cap) break;
      const area = polygonArea(f.p);
      if (area < AREA_PER_TREE) continue;

      // bbox контура — сеем точки в нём и отбраковываем те, что вне полигона
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of f.p) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      const want = Math.min(Math.floor(area / AREA_PER_TREE), cap - needle.length - broad.length);
      // Попыток с запасом: часть точек bbox не попадёт в полигон
      const maxAttempts = want * 6;
      let placed = 0;
      for (let attempt = 0; attempt < maxAttempts && placed < want; attempt++) {
        const x = minX + rnd() * (maxX - minX);
        const z = minZ + rnd() * (maxZ - minZ);
        if (!pointInPolygon(x, z, f.p)) continue;
        // Лес может выходить за рабочий периметр — деревья снаружи не нужны
        if (perimeter && !pointInPolygon(x, z, perimeter)) continue;

        const h = 6 + rnd() * 7;                // высота дерева 6–13 м
        const y = elevAt(x, z);
        pos.set(x, y, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
        scl.set(1, h / 10, 1);                  // базовая геометрия рассчитана на 10 м
        m.compose(pos, q, scl);

        const isNeedle = f.leaf === 'needle' || (f.leaf === 'mixed' && rnd() < 0.5);
        (isNeedle ? needle : broad).push(m.clone());
        placed++;
      }
    }
    return { needle, broad };
  }, [nature, elevAt, perimeter]);

  // ── Вода: горизонтальная плоскость по контуру на отметке уровня ──
  const waterGeometry = useMemo(() => {
    if (!nature || nature.water.length === 0) return null;
    const parts: THREE.BufferGeometry[] = [];
    for (const w of nature.water) {
      if (w.p.length < 3) continue;

      // Сегмент реки: четырёхугольник с отметкой на каждой вершине. Плоскость
      // с единым level давала ступеньку на стыке с соседним сегментом —
      // здесь смежные вершины совпадают по высоте, и полотно непрерывно.
      if (w.levels && w.levels.length === w.p.length && w.p.length === 4) {
        const geo = new THREE.BufferGeometry();
        const v: number[] = [];
        for (let i = 0; i < 4; i++) v.push(w.p[i][0], w.levels[i], w.p[i][1]);
        geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        // UV обязателен: mergeGeometries требует одинаковый набор атрибутов,
        // а ShapeGeometry (стоячая вода) его добавляет — иначе слияние
        // вернёт null и вода пропадёт целиком
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        geo.setIndex([0, 2, 1, 0, 3, 2]);
        geo.computeVertexNormals();
        parts.push(geo);
        continue;
      }

      // Стоячая вода — горизонтальный контур.
      // Shape в плоскости XY; y = -z, чтобы после rotateX(-90°) знак Z сошёлся
      const shape = new THREE.Shape();
      shape.moveTo(w.p[0][0], -w.p[0][1]);
      for (let i = 1; i < w.p.length; i++) shape.lineTo(w.p[i][0], -w.p[i][1]);
      shape.closePath();
      try {
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        // Ровно на реальной отметке: русло вырезано импортёром ниже уровня
        // воды, поэтому запас против z-fighting уже не нужен.
        geo.translate(0, w.level, 0);
        parts.push(geo);
      } catch {
        /* редкие самопересекающиеся контуры OSM — пропускаем */
      }
    }
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
  }, [nature]);

  // Ствол и кроны: низкополигональные, форма читается силуэтом
  const trunkGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.28, 0.42, 4, 5);
    g.translate(0, 2, 0);
    return g;
  }, []);
  const needleGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(2.2, 8, 7); // ёлка — вытянутый конус
    g.translate(0, 6, 0);
    return g;
  }, []);
  const broadGeo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(2.7, 0); // лиственное — «кругляш»
    g.scale(1, 0.85, 1);
    g.translate(0, 6.2, 0);
    return g;
  }, []);

  useEffect(() => () => {
    trunkGeo.dispose(); needleGeo.dispose(); broadGeo.dispose();
    waterGeometry?.dispose();
  }, [trunkGeo, needleGeo, broadGeo, waterGeometry]);

  if (!showNature) return null;

  const allTrees = trees ? [...trees.needle, ...trees.broad] : [];

  return (
    <group>
      {/* Вода */}
      {waterGeometry && (
        <mesh geometry={waterGeometry} receiveShadow>
          <meshStandardMaterial
            color="#3b7ea1"
            roughness={0.15}
            metalness={0.35}
            transparent
            opacity={xray ? 0.25 : 0.82}
            depthWrite={!xray}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Стволы — общие для обоих типов деревьев */}
      {allTrees.length > 0 && (
        <Instanced geometry={trunkGeo} matrices={allTrees} color="#6b4f36" castShadow />
      )}
      {/* Кроны хвойных */}
      {trees && trees.needle.length > 0 && (
        <Instanced geometry={needleGeo} matrices={trees.needle} color="#2f5d3a" castShadow />
      )}
      {/* Кроны лиственных */}
      {trees && trees.broad.length > 0 && (
        <Instanced geometry={broadGeo} matrices={trees.broad} color="#4a7c3f" castShadow />
      )}
    </group>
  );
}

/** InstancedMesh с проставленными матрицами */
function Instanced({
  geometry,
  matrices,
  color,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  matrices: THREE.Matrix4[];
  color: string;
  castShadow?: boolean;
}) {
  const mesh = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true });
    const im = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = !!castShadow;
    im.receiveShadow = true;
    im.frustumCulled = false; // матрицы в инстансах — bbox считается неверно
    return im;
  }, [geometry, matrices, color, castShadow]);

  useEffect(() => () => {
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

  return <primitive object={mesh} />;
}
