import * as THREE from 'three';

/**
 * Пересечение луча с рельефом маршем по лучу вместо перебора треугольников.
 *
 * Рельеф — это до 820 тыс. треугольников, и штатный `Mesh.raycast` честно
 * проверяет каждый. Пока по земле ничего не рисуют, меш просто не участвует в
 * событиях и это никого не трогает. Но стоит взять забор, сети или рулетку —
 * и перебор идёт на каждое движение мыши: кадры проваливаются со 140 до 13.
 *
 * Здесь то же пересечение считается по полю высот: шагаем вдоль луча, ищем,
 * где он ныряет под поверхность, и уточняем место делением отрезка пополам.
 * Работы — пара сотен выборок из массива высот вместо сотен тысяч проверок
 * треугольников, и она не зависит от подробности меша.
 *
 * Точность выше, чем у меша: высота берётся из самих данных DEM, а не из
 * вершин, которыми он аппроксимирован.
 */

export type HeightSampler = (x: number, z: number) => number;

/** Дальше этого расстояния луч не ищет землю (метры) */
const MAX_RANGE = 200_000;
/** Делений при уточнении места пересечения — 24 хватает на микрон */
const REFINE_STEPS = 24;
/**
 * Потолок выборок на один луч.
 *
 * Держит цену пика постоянной, что бы ни происходило. Без него луч в небо
 * (курсор выше горизонта — обычное дело) шёл бы до конца площадки впустую:
 * земли там нет, а шаги считаются.
 */
const MAX_STEPS = 512;

export function makeHeightfieldRaycast(
  sample: HeightSampler,
  sizeX: number,
  sizeZ: number,
): (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void {
  const inverse = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const local = new THREE.Ray();
  const probe = new THREE.Vector3();
  const hitLocal = new THREE.Vector3();
  const hitWorld = new THREE.Vector3();

  const halfX = sizeX / 2;
  const halfZ = sizeZ / 2;
  const span = Math.max(sizeX, sizeZ);
  /*
   * Желаемый шаг марша. Мельче — дороже, крупнее — можно перепрыгнуть узкий
   * гребень и попасть в склон за ним. Пятьсот шагов на всю площадку: на
   * километровой это два метра, а холмов уже такого масштаба не бывает.
   */
  const baseStep = Math.min(Math.max(span / MAX_STEPS, 0.05), 4);
  /** Плечо для наклона поверхности в точке попадания */
  const eps = Math.min(Math.max(span / 2048, 0.02), 1);

  /** Отрезок параметра луча, на котором он находится над площадкой по X и Z */
  function clipToFootprint(ray: THREE.Ray): [number, number] | null {
    let tMin = 0;
    let tMax = MAX_RANGE;

    for (const axis of ['x', 'z'] as const) {
      const half = axis === 'x' ? halfX : halfZ;
      const origin = ray.origin[axis];
      const dir = ray.direction[axis];
      if (Math.abs(dir) < 1e-9) {
        // Луч идёт вдоль другой оси: либо всё время над площадкой, либо мимо
        if (origin < -half || origin > half) return null;
        continue;
      }
      const t1 = (-half - origin) / dir;
      const t2 = (half - origin) / dir;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
      if (tMin > tMax) return null;
    }

    return [tMin, tMax];
  }

  return function heightfieldRaycast(
    this: THREE.Object3D,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ): void {
    inverse.copy(this.matrixWorld).invert();
    local.copy(raycaster.ray).applyMatrix4(inverse);

    const range = clipToFootprint(local);
    if (!range) return;
    const [tMin, tMax] = range;

    /** Насколько луч выше земли в данной точке параметра */
    const gap = (t: number): number => {
      local.at(t, probe);
      return probe.y - sample(probe.x, probe.z);
    };

    // Камера под землёй — считать это попаданием нельзя: точка уехала бы
    // за спину смотрящему
    if (gap(tMin) <= 0) return;

    // Луч вниз по площадке в горизонтальные границы не упирается, так что
    // отрезок может оказаться каким угодно длинным. Шаг растягивается под
    // него, лишь бы выборок было не больше потолка
    const step = Math.max(baseStep, (tMax - tMin) / MAX_STEPS);

    let prevT = tMin;
    let hitT = -1;
    for (let t = tMin + step; t <= tMax; t += step) {
      if (gap(t) <= 0) {
        // Нырнули под поверхность между prevT и t — уточняем делением пополам
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < REFINE_STEPS; i++) {
          const mid = (lo + hi) / 2;
          if (gap(mid) > 0) lo = mid;
          else hi = mid;
        }
        hitT = (lo + hi) / 2;
        break;
      }
      prevT = t;
    }
    if (hitT < 0) return;

    local.at(hitT, hitLocal);
    hitWorld.copy(hitLocal).applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(hitWorld);
    if (distance < raycaster.near || distance > raycaster.far) return;

    // Наклон поверхности — по разности высот вокруг точки. Нужен тем, кто
    // ставит объекты по нормали к земле
    const x = hitLocal.x;
    const z = hitLocal.z;
    const normal = new THREE.Vector3(
      sample(x - eps, z) - sample(x + eps, z),
      2 * eps,
      sample(x, z - eps) - sample(x, z + eps),
    ).normalize();
    normalMatrix.getNormalMatrix(this.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();

    intersects.push({
      distance,
      point: hitWorld.clone(),
      object: this,
      face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 },
    });
  };
}
