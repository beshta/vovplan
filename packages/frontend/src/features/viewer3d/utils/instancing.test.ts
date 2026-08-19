import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collapseInstances, mergeByMaterial, optimizeModel } from './instancing';

const box = (sx = 1, sy = 1, sz = 1) => new THREE.BoxGeometry(sx, sy, sz);
const red = () => new THREE.MeshStandardMaterial({ color: 0xff0000 });
const blue = () => new THREE.MeshStandardMaterial({ color: 0x0000ff });

function meshCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('collapseInstances', () => {
  it('одинаковые копии одной геометрии становятся одним InstancedMesh', () => {
    const root = new THREE.Group();
    const geo = box();
    const mat = red();
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(i * 2, 0, 0);
      root.add(m);
    }
    const { before, after } = collapseInstances(root);
    expect(before).toBe(5);
    expect(after).toBe(1);
    expect(meshCount(root)).toBe(1);
    expect((root.children[0] as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    expect((root.children[0] as THREE.InstancedMesh).count).toBe(5);
  });
});

describe('mergeByMaterial', () => {
  it('разные геометрии одного цвета склеиваются в один меш', () => {
    const root = new THREE.Group();
    const mat = red();
    const a = new THREE.Mesh(box(1, 1, 1), mat);
    const b = new THREE.Mesh(box(2, 0.5, 0.5), mat);
    a.position.set(10, 0, 0);
    b.position.set(0, 0, 7);
    root.add(a, b);

    const { before, after } = mergeByMaterial(root);
    expect(before).toBe(2);
    expect(after).toBe(1);
    expect(meshCount(root)).toBe(1);

    const merged = root.children[0] as THREE.Mesh;
    merged.updateWorldMatrix(true, true);
    const box3 = new THREE.Box3().setFromObject(merged);
    expect(box3.min.x).toBeLessThan(0);
    expect(box3.max.x).toBeGreaterThan(9);
    expect(box3.max.z).toBeGreaterThan(6);
  });

  it('разный цвет не склеивается', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(box(), red()), new THREE.Mesh(box(2, 2, 2), blue()));
    const { after } = mergeByMaterial(root);
    expect(after).toBe(2);
    expect(meshCount(root)).toBe(2);
  });
});

describe('optimizeModel', () => {
  it('настоящие копии (одинаковые вершины, разные объекты геометрии) становятся InstancedMesh', () => {
    const root = new THREE.Group();
    const mat = red();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(box(1, 1, 1), mat);
      m.position.set(i * 3, 0, 0);
      root.add(m);
    }
    optimizeModel(root);
    expect(meshCount(root)).toBe(1);
    const only = root.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.InstancedMesh;
    expect(only.isInstancedMesh).toBe(true);
    expect(only.count).toBe(8);
  });

  it('сводит кучу уникальных кусков одного цвета к одному вызову', () => {
    const root = new THREE.Group();
    const color = red();
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(box(1 + i * 0.01, 1, 1), color);
      m.position.set(i, 0, 0);
      root.add(m);
    }
    optimizeModel(root);
    expect(meshCount(root)).toBe(1);
  });

  it('не портит исходную геометрию — bake идёт на копии', () => {
    const root = new THREE.Group();
    const geo = box();
    const x0 = geo.attributes.position.getX(0);
    const m1 = new THREE.Mesh(geo, red());
    const m2 = new THREE.Mesh(box(2, 1, 1), m1.material);
    m2.position.set(5, 0, 0);
    root.add(m1, m2);
    optimizeModel(root);
    expect(geo.attributes.position.getX(0)).toBe(x0);
  });
});
