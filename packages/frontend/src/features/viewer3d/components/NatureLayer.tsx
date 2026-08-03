import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
const AREA_PER_TREE = 520;
/**
 * Минимальная площадь, при которой массив всё же получает дерево. Без этого
 * floor(площадь / AREA_PER_TREE) обнулял всё, что меньше порога: на реальной
 * площадке в центре Москвы 18 скверов из 31 оставались голой землёй, хотя на
 * карте под ними нарисован лес.
 */
const MIN_FOREST_AREA = 90;
/** Потолок числа деревьев (десктоп / слабое устройство) */
const MAX_TREES = 6_000;
const MAX_TREES_LOW = 1_500;

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
export default function NatureLayer({ meta }: { meta: TerrainMeta }) {
  const showNature = useViewerStore((s) => s.showNature);
  const xray = useViewerStore((s) => s.xrayMode);
  const [nature, setNature] = useState<{ forests: ForestArea[]; water: WaterArea[] } | null>(null);
  /**
   * Высоту берём у рельефа, а не считаем сами: раньше здесь заново грузилась
   * и декодировалась карта высот (для 2048² это ~16 МБ обратного чтения из
   * canvas — вторым разом), а логика интерполяции дублировалась и могла
   * разойтись с той, по которой построен меш.
   */
  const elevAt = useViewerStore((s) => s.groundSampler);

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

  // ── Деревья: детерминированная расстановка внутри контуров леса ──
  const perimeter = meta.polygon && meta.polygon.length >= 3 ? meta.polygon : null;

  const trees = useMemo(() => {
    // Без рельефа сажать некуда — пересчитается, как только он опубликует высоты
    if (!elevAt || !nature || nature.forests.length === 0) return null;
    const cap = detectQuality().isMobile ? MAX_TREES_LOW : MAX_TREES;

    // Контуры леса в OSM заходят на воду (по данным Москвы-реки — 2 массива
    // из 31 центром прямо в русле), и деревья вырастали посреди реки.
    // Предрассчитываем габариты водоёмов: проверять каждое дерево по всем
    // контурам дорого, а отсев по bbox отбрасывает почти все сразу.
    const waterBoxes = (nature.water ?? []).map((w) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of w.p) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      return { p: w.p, x0, x1, z0, z1 };
    });
    const inWater = (x: number, z: number): boolean => {
      for (const b of waterBoxes) {
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (pointInPolygon(x, z, b.p)) return true;
      }
      return false;
    };

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
      if (area < MIN_FOREST_AREA) continue;

      // bbox контура — сеем точки в нём и отбраковываем те, что вне полигона
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of f.p) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      // round, а не floor: сквер в 400 м² получает дерево, а не ноль
      const want = Math.min(
        Math.max(1, Math.round(area / AREA_PER_TREE)),
        cap - needle.length - broad.length,
      );
      // Попыток с запасом: часть точек bbox не попадёт в полигон
      const maxAttempts = want * 6;
      let placed = 0;
      for (let attempt = 0; attempt < maxAttempts && placed < want; attempt++) {
        const x = minX + rnd() * (maxX - minX);
        const z = minZ + rnd() * (maxZ - minZ);
        if (!pointInPolygon(x, z, f.p)) continue;
        // Лес может выходить за рабочий периметр — деревья снаружи не нужны
        if (perimeter && !pointInPolygon(x, z, perimeter)) continue;
        // И не растут посреди реки
        if (inWater(x, z)) continue;

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

  // Ствол и кроны. Форма читается силуэтом, поэтому геометрия предельно
  // дешёвая: без крышек и с минимумом граней — вместо ~35 треугольников на
  // дерево выходит ~13, а деревьев в кадре тысячи.
  const trunkGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.3, 0.4, 4, 3, 1, true); // 3 грани, открытый
    g.translate(0, 2, 0);
    return g;
  }, []);
  const needleGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(2.2, 8, 5, 1, true); // ёлка — конус без дна
    g.translate(0, 6, 0);
    return g;
  }, []);
  const broadGeo = useMemo(() => {
    const g = new THREE.OctahedronGeometry(2.7, 0); // лиственное — «кругляш», 8 граней
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

      {/* Деревья теней не отбрасывают: отрисовка теневой карты для тысяч
          инстансов дороже самой сцены, а на схематичных деревьях выигрыш
          в реализме мизерный */}
      {allTrees.length > 0 && (
        <Instanced geometry={trunkGeo} matrices={allTrees} color="#6b4f36" />
      )}
      {/* Кроны хвойных */}
      {trees && trees.needle.length > 0 && (
        <Instanced geometry={needleGeo} matrices={trees.needle} color="#2f5d3a" />
      )}
      {/* Кроны лиственных */}
      {trees && trees.broad.length > 0 && (
        <Instanced geometry={broadGeo} matrices={trees.broad} color="#4a7c3f" />
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
    // Габариты считаем по матрицам инстансов — тогда отсечение по пирамиде
    // видимости работает корректно и группа пропускается, когда не в кадре
    im.computeBoundingSphere();
    return im;
  }, [geometry, matrices, color, castShadow]);

  useEffect(() => () => {
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

  return <primitive object={mesh} />;
}
