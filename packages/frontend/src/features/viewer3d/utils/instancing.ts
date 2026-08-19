import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Схлопывает повторяющиеся меши в аппаратные копии.
 *
 * Чертёж почти целиком состоит из повторов: одна стойка лесов встречается
 * сотни раз. После загрузки каждая копия — отдельный меш, и видеокарта рисует
 * их по одной. На проверочной сцене это 14 819 вызовов отрисовки и 23 кадра в
 * секунду, причём треугольников всего два миллиона — упирается не в них.
 *
 * `InstancedMesh` рисует все копии одной геометрии за один вызов, передавая
 * матрицы массивом. Для того же чертежа остаётся около пятисот вызовов.
 *
 * Условие объединения — общая геометрия и общий материал. Загрузчик glTF
 * переиспользует и то и другое, когда узлы ссылаются на один примитив, так
 * что после импорта DWG условие выполняется само собой.
 */
export function collapseInstances(root: THREE.Object3D): {
  before: number;
  after: number;
} {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  // Группируем по паре «геометрия + материал»: разные материалы за один
  // вызов не нарисовать, а разные геометрии — тем более
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    const key = `${mesh.geometry.uuid}|${material.uuid}`;
    const list = groups.get(key);
    if (list) list.push(mesh);
    else groups.set(key, [mesh]);
  });

  const before = [...groups.values()].reduce((n, g) => n + g.length, 0);
  let after = 0;

  for (const meshes of groups.values()) {
    // Одиночку трогать незачем: аппаратная копия из одного элемента
    // рисуется тем же одним вызовом, только через лишний слой
    if (meshes.length < 2) {
      after += meshes.length;
      continue;
    }

    const sample = meshes[0];
    const material = Array.isArray(sample.material) ? sample.material[0] : sample.material;
    const inst = new THREE.InstancedMesh(sample.geometry, material, meshes.length);
    inst.castShadow = sample.castShadow;
    inst.receiveShadow = sample.receiveShadow;
    inst.name = sample.name;

    const local = new THREE.Matrix4();
    meshes.forEach((mesh, i) => {
      // Матрица копии относительно корня модели: сам корень будет двигать
      // и вращать объект целиком, поэтому его преобразование надо снять
      mesh.updateWorldMatrix(true, false);
      local.copy(rootInverse).multiply(mesh.matrixWorld);
      inst.setMatrixAt(i, local);
      mesh.removeFromParent();
    });
    inst.instanceMatrix.needsUpdate = true;
    // Границы нужны отсечению по камере: без них копии считаются лежащими
    // в начале координат и пропадают, стоит отвести взгляд
    inst.computeBoundingSphere();

    root.add(inst);
    after += 1;
  }

  return { before, after };
}

function isPlainMesh(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length) return false;
  return true;
}

function singleMaterial(mesh: THREE.Mesh): THREE.Material | null {
  if (Array.isArray(mesh.material)) return mesh.material.length === 1 ? mesh.material[0] : null;
  return mesh.material ?? null;
}

/** Как выглядит материал, а не какой у него uuid: CAD плодит копии с одним цветом. */
function materialFingerprint(mat: THREE.Material): string {
  const std = mat as THREE.MeshStandardMaterial;
  return [
    mat.type,
    std.color?.getHex?.() ?? 0,
    std.map?.uuid ?? '',
    std.metalness ?? '',
    std.roughness ?? '',
    mat.opacity,
    mat.transparent ? 1 : 0,
    mat.side,
    std.emissive?.getHex?.() ?? 0,
    std.emissiveMap?.uuid ?? '',
    std.normalMap?.uuid ?? '',
    mat.vertexColors ? 1 : 0,
  ].join('|');
}

function geometryFingerprint(geo: THREE.BufferGeometry): string {
  const pos = geo.getAttribute('position');
  if (!pos) return geo.uuid;
  const arr = pos.array;
  let h = 5381;
  for (let i = 0; i < arr.length; i++) {
    h = ((h << 5) + h) ^ ((arr[i] * 1000) | 0);
  }
  const names = Object.keys(geo.attributes).sort().join(',');
  return `${arr.length}:${h >>> 0}:${names}:${geo.index ? geo.index.count : 0}`;
}

function attrSignature(geo: THREE.BufferGeometry): string {
  return `${Object.keys(geo.attributes).sort().join(',')}|${geo.index ? 'i' : 'n'}`;
}

/**
 * Одинаковые материалы и геометрии начинают ссылаться на один объект.
 *
 * Экспортёры CAD часто копируют и то и другое на каждый узел: uuid разный,
 * содержимое одно. Без этого collapseInstances не видит повторов.
 */
function shareDuplicates(root: THREE.Object3D): void {
  const materials = new Map<string, THREE.Material>();
  const geometries = new Map<string, THREE.BufferGeometry>();

  root.traverse((o) => {
    if (!isPlainMesh(o)) return;
    const mat = singleMaterial(o);
    if (mat) {
      const key = materialFingerprint(mat);
      const shared = materials.get(key) ?? mat;
      if (!materials.has(key)) materials.set(key, mat);
      o.material = shared;
    }
    const gKey = geometryFingerprint(o.geometry);
    const sharedGeo = geometries.get(gKey) ?? o.geometry;
    if (!geometries.has(gKey)) geometries.set(gKey, o.geometry);
    o.geometry = sharedGeo;
  });
}

/**
 * Оставшиеся разные меши с одним материалом склеиваются в один.
 *
 * Instancing помогает только когда геометрия буквально общая. У сцены,
 * экспортированной «каждая стойка — свой меш», uuid все разные, и без склейки
 * остаётся пять тысяч вызовов отрисовки на два объекта — даже в стоп-кадре.
 * Треугольников столько же, вызовов — по числу материалов, а не деталей.
 */
export function mergeByMaterial(root: THREE.Object3D): { before: number; after: number } {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();

  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    if (!isPlainMesh(o)) return;
    const mat = singleMaterial(o);
    if (!mat) return;
    const key = `${mat.uuid}|${attrSignature(o.geometry)}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  });

  const before = [...groups.values()].reduce((n, g) => n + g.length, 0);
  let after = 0;

  for (const meshes of groups.values()) {
    if (meshes.length < 2) {
      after += meshes.length;
      continue;
    }

    const parts: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      local.copy(rootInverse).multiply(mesh.matrixWorld);
      // clone всегда: toNonIndexed() на уже развёрнутой геометрии возвращает
      // её саму, и applyMatrix4 испортил бы общий буфер загрузчика glTF
      let baked = mesh.geometry.clone();
      if (baked.index) {
        const flat = baked.toNonIndexed();
        baked.dispose();
        baked = flat;
      }
      baked.applyMatrix4(local);
      parts.push(baked);
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!merged) {
      after += meshes.length;
      continue;
    }

    const sample = meshes[0];
    const material = singleMaterial(sample)!;
    const out = new THREE.Mesh(merged, material);
    out.name = sample.name;
    out.castShadow = meshes.some((m) => m.castShadow);
    out.receiveShadow = meshes.some((m) => m.receiveShadow);
    merged.computeBoundingSphere();
    root.add(out);
    for (const mesh of meshes) mesh.removeFromParent();
    after += 1;
  }

  return { before, after };
}

/** Пустые группы после снятия мешей всё ещё обходятся каждый кадр. */
function pruneEmptyGroups(node: THREE.Object3D, root: THREE.Object3D): void {
  for (const child of [...node.children]) pruneEmptyGroups(child, root);
  if (node === root) return;
  if (node.children.length > 0) return;
  if ((node as THREE.Mesh).isMesh) return;
  if ((node as THREE.Line).isLine) return;
  if ((node as THREE.Points).isPoints) return;
  if ((node as THREE.Light).isLight) return;
  if ((node as THREE.Camera).isCamera) return;
  node.removeFromParent();
}

/**
 * Подготовка модели к показу: повторы → InstancedMesh, остальное → склейка
 * по материалу. Вызывать один раз на загруженный GLB.
 */
export function optimizeModel(root: THREE.Object3D): void {
  shareDuplicates(root);
  collapseInstances(root);
  mergeByMaterial(root);
  pruneEmptyGroups(root, root);
}

/**
 * Габариты в собственных осях объекта.
 *
 * Мерить надо до поворота: у повёрнутой на 30° стойки мировая коробка шире
 * самой стойки, и человек увидит размер, которого у объекта нет.
 */
export function localSize(object: THREE.Object3D): [number, number, number] {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert();

  object.updateWorldMatrix(true, true);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // Берём коробку геометрии и гоняем восемь её углов, а не все вершины:
    // на пятнадцати тысячах копий разница между этим и полным перебором —
    // доли секунды против нескольких секунд, а размер тот же
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const gb = mesh.geometry.boundingBox;
    if (!gb) return;

    const toObject = new THREE.Matrix4().copy(inverse).multiply(mesh.matrixWorld);
    const inst = mesh as unknown as THREE.InstancedMesh;
    const copies = inst.isInstancedMesh ? inst.count : 1;
    const copyMatrix = new THREE.Matrix4();
    const full = new THREE.Matrix4();

    for (let c = 0; c < copies; c++) {
      if (inst.isInstancedMesh) {
        inst.getMatrixAt(c, copyMatrix);
        full.copy(toObject).multiply(copyMatrix);
      } else {
        full.copy(toObject);
      }
      for (let k = 0; k < 8; k++) {
        point.set(
          k & 1 ? gb.max.x : gb.min.x,
          k & 2 ? gb.max.y : gb.min.y,
          k & 4 ? gb.max.z : gb.min.z,
        );
        box.expandByPoint(point.applyMatrix4(full));
      }
    }
  });

  if (box.isEmpty()) return [0, 0, 0];
  const size = new THREE.Vector3();
  box.getSize(size);
  return [size.x, size.y, size.z];
}
