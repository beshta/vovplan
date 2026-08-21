import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeHeightfieldRaycast, type HeightSampler } from './heightfieldPick';

const SIZE = 200;

/** Меш-пустышка: рейкасту от него нужна только матрица мира */
function terrain(): THREE.Object3D {
  const o = new THREE.Object3D();
  o.updateMatrixWorld(true);
  return o;
}

function shoot(
  sample: HeightSampler,
  origin: [number, number, number],
  direction: [number, number, number],
  object: THREE.Object3D = terrain(),
): THREE.Intersection[] {
  const raycaster = new THREE.Raycaster();
  raycaster.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
  const hits: THREE.Intersection[] = [];
  makeHeightfieldRaycast(sample, SIZE, SIZE).call(object, raycaster, hits);
  return hits;
}

const FLAT: HeightSampler = () => 0;
/** Склон 1:10 вдоль X */
const SLOPE: HeightSampler = (x) => x * 0.1;

describe('makeHeightfieldRaycast', () => {
  it('находит землю под камерой', () => {
    const [hit] = shoot(FLAT, [10, 50, -20], [0, -1, 0]);
    expect(hit).toBeDefined();
    expect(hit.point.x).toBeCloseTo(10, 3);
    expect(hit.point.z).toBeCloseTo(-20, 3);
    expect(hit.point.y).toBeCloseTo(0, 3);
    expect(hit.distance).toBeCloseTo(50, 3);
  });

  it('находит склон там же, где его показывает поле высот', () => {
    const [hit] = shoot(SLOPE, [30, 40, 5], [0, -1, 0]);
    expect(hit.point.y).toBeCloseTo(3, 2);
    expect(hit.point.x).toBeCloseTo(30, 2);
  });

  it('нормаль на ровном месте смотрит вверх, на склоне — отклоняется в горку', () => {
    const [flat] = shoot(FLAT, [0, 20, 0], [0, -1, 0]);
    expect(flat.face!.normal.y).toBeCloseTo(1, 5);

    const [slope] = shoot(SLOPE, [0, 20, 0], [0, -1, 0]);
    expect(slope.face!.normal.y).toBeGreaterThan(0.9);
    expect(slope.face!.normal.x).toBeCloseTo(-0.0995, 3);
    expect(slope.face!.normal.length()).toBeCloseTo(1, 6);
  });

  it('ловит дальний склон косым лучом, а не только точку под собой', () => {
    // С высоты 20 под 45° земля ровная — попадание в 20 метрах вперёд
    const [hit] = shoot(FLAT, [-60, 20, 0], [1, -1, 0]);
    expect(hit.point.x).toBeCloseTo(-40, 1);
    expect(hit.point.y).toBeCloseTo(0, 1);
  });

  it('мимо площадки — не попадание', () => {
    expect(shoot(FLAT, [1000, 50, 1000], [0, -1, 0])).toHaveLength(0);
  });

  it('луч в небо не находит землю', () => {
    expect(shoot(FLAT, [0, 10, 0], [0, 1, 0])).toHaveLength(0);
  });

  it('из-под земли не стреляем: точка попадания оказалась бы за спиной', () => {
    expect(shoot(FLAT, [0, -5, 0], [0, -1, 0])).toHaveLength(0);
  });

  it('уважает сдвиг и поворот меша', () => {
    const object = new THREE.Object3D();
    object.position.set(0, 7, 0);
    object.updateMatrixWorld(true);
    const [hit] = shoot(FLAT, [3, 50, 3], [0, -1, 0], object);
    expect(hit.point.y).toBeCloseTo(7, 3);
    expect(hit.distance).toBeCloseTo(43, 3);
  });

  it('дальше raycaster.far попадание не отдаём', () => {
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, -1, 0));
    raycaster.far = 100;
    const hits: THREE.Intersection[] = [];
    makeHeightfieldRaycast(FLAT, SIZE, SIZE).call(terrain(), raycaster, hits);
    expect(hits).toHaveLength(0);
  });

  it('цена луча не зависит от того, где земля: выборок всегда немного', () => {
    let calls = 0;
    const counted: HeightSampler = () => {
      calls++;
      return 0;
    };
    // Луч в небо — худший случай: земли не будет найдено никогда
    shoot(counted, [0, 1, 0], [0, 1, 0]);
    expect(calls).toBeLessThan(600);
  });
});
