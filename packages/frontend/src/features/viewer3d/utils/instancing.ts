import * as THREE from 'three';

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
