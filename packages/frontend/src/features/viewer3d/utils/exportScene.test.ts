import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildExportRoot, exportFileName } from './exportScene';

/**
 * Выгрузка теряет геометрию молча: файл скачивается, весит килобайты, а внутри
 * пусто — и узнаётся об этом, когда его открывают в чужой программе.
 *
 * Опаснее всего аппаратные копии. Забор — это одна секция, повторённая
 * восемьдесят раз; чертёж DWG — тысяча деталей на десять тысяч копий. Если их
 * не разложить, в файл уйдёт по одному экземпляру каждой, и пропажи
 * восьмидесяти секций забора никто не заметит до самого Blender.
 */

const box = () => new THREE.BoxGeometry(1, 1, 1);
const mat = () => new THREE.MeshStandardMaterial();

/** Сколько мешей в собранном корне */
const meshCount = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

describe('сборка сцены для выгрузки', () => {
  it('аппаратные копии раскладываются в отдельные меши', () => {
    const scene = new THREE.Scene();
    const inst = new THREE.InstancedMesh(box(), mat(), 5);
    for (let i = 0; i < 5; i++) {
      inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 2, 0, 0));
    }
    scene.add(inst);

    const { root, instances } = buildExportRoot(scene);

    expect(instances).toBe(5);
    expect(meshCount(root)).toBe(5);
    // Ни одной аппаратной копии в выгрузке остаться не должно: их запись
    // требует расширения glTF, без которого файл не открывается вовсе
    let leftovers = 0;
    root.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) leftovers++;
    });
    expect(leftovers).toBe(0);
  });

  it('разложенные копии сохраняют своё место в пространстве', () => {
    const scene = new THREE.Scene();
    const inst = new THREE.InstancedMesh(box(), mat(), 2);
    inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
    inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, 7));
    // Сам носитель тоже сдвинут: положение копии складывается из обоих
    inst.position.set(100, 0, 0);
    scene.add(inst);

    const { root } = buildExportRoot(scene);
    const xs = root.children.map((c) => Math.round(c.position.x));
    const zs = root.children.map((c) => Math.round(c.position.z));

    expect(xs.sort((a, b) => a - b)).toEqual([100, 110]);
    expect(zs.sort((a, b) => a - b)).toEqual([0, 7]);
  });

  it('служебное содержимое не попадает в файл', () => {
    const scene = new THREE.Scene();

    const useful = new THREE.Mesh(box(), mat());
    useful.name = 'объект';
    scene.add(useful);

    // Сетка-подложка, курсоры коллег, черновики — помечены в Scene
    const service = new THREE.Group();
    service.userData.noExport = true;
    service.add(new THREE.Mesh(box(), mat()));
    service.add(new THREE.Mesh(box(), mat()));
    scene.add(service);

    const { root } = buildExportRoot(scene);
    expect(meshCount(root)).toBe(1);
  });

  it('свет и камеры не выгружаются — в каждой программе своя постановка', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(box(), mat()));
    scene.add(new THREE.DirectionalLight());
    scene.add(new THREE.AmbientLight());
    scene.add(new THREE.PerspectiveCamera());
    scene.add(new THREE.GridHelper(10, 10));

    const { root } = buildExportRoot(scene);
    expect(root.children).toHaveLength(1);
  });

  it('скрытое глазом не уходит в файл', () => {
    const scene = new THREE.Scene();
    const hidden = new THREE.Mesh(box(), mat());
    hidden.visible = false;
    scene.add(hidden);
    scene.add(new THREE.Mesh(box(), mat()));

    const { root } = buildExportRoot(scene);
    expect(meshCount(root)).toBe(1);
  });

  it('рельеф исключается по требованию и включается по требованию', () => {
    const scene = new THREE.Scene();
    const terrain = new THREE.Mesh(box(), mat());
    terrain.name = 'terrain';
    scene.add(terrain);
    scene.add(new THREE.Mesh(box(), mat()));

    expect(meshCount(buildExportRoot(scene, { includeTerrain: false }).root)).toBe(1);
    expect(meshCount(buildExportRoot(scene, { includeTerrain: true }).root)).toBe(2);
  });

  it('треугольники считаются, чтобы человек увидел объём выгруженного', () => {
    const scene = new THREE.Scene();
    // Коробка — 12 треугольников; три копии дают 36
    const inst = new THREE.InstancedMesh(box(), mat(), 3);
    for (let i = 0; i < 3; i++) inst.setMatrixAt(i, new THREE.Matrix4());
    scene.add(inst);

    const { triangles } = buildExportRoot(scene);
    expect(triangles).toBe(36);
  });

  it('вложенные объекты обходятся вглубь', () => {
    const scene = new THREE.Scene();
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(new THREE.Mesh(box(), mat()));
    outer.add(inner);
    scene.add(outer);

    expect(meshCount(buildExportRoot(scene).root)).toBe(1);
  });
});

describe('имя файла', () => {
  it('строится из названия проекта и даты', () => {
    expect(exportFileName('Чтиво2')).toMatch(/^Чтиво2-\d{4}-\d{2}-\d{2}\.glb$/);
  });

  it('запрещённые в именах файлов знаки убираются', () => {
    // Иначе браузер молча откажется сохранять файл
    expect(exportFileName('Проект: "А/Б" <тест>')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('у безымянного проекта имя всё равно есть', () => {
    expect(exportFileName('')).toMatch(/^сцена-/);
  });
});
