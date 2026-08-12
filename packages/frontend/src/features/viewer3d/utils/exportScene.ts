import * as THREE from 'three';

/**
 * Выгрузка сцены целиком в один файл GLB.
 *
 * Две вещи, без которых файл выглядит целым, но таковым не является.
 *
 * Первая — аппаратные копии. Наша сцена держится на них: забор это одна секция,
 * повторённая восемьдесят раз, чертёж DWG — тысяча деталей на десять тысяч
 * копий. Экспортёр three их умеет, но записывает расширением
 * EXT_mesh_gpu_instancing и помечает его ОБЯЗАТЕЛЬНЫМ: программа, которая
 * расширения не знает, отказывается открыть файл целиком. Поэтому копии
 * раскладываются в обычные узлы. Геометрия при этом не размножается —
 * экспортёр складывает одинаковую в файл один раз и ссылается на неё из всех
 * узлов, так что размер почти не растёт.
 *
 * Вторая — служебное содержимое сцены: сетка-подложка, курсоры коллег,
 * черновики, рулетка. В файле проекта им делать нечего.
 */

/** Такие объекты в выгрузку не идут — помечаются при создании */
export const NO_EXPORT = 'noExport';

/** Пометить объект и всё под ним как служебное */
export function markNoExport(object: THREE.Object3D | null): void {
  if (object) object.userData[NO_EXPORT] = true;
}

export interface ExportOptions {
  /** Рельеф — самая тяжёлая часть файла, иногда он не нужен */
  includeTerrain?: boolean;
  /** Куда сообщать о ходе работы: этап и доля от 0 до 1 */
  onProgress?: (stage: string, progress: number) => void;
}

export interface ExportResult {
  blob: Blob;
  /** Сколько треугольников попало в файл — по ним человек и поймёт, всё ли на месте */
  triangles: number;
  /** Сколько аппаратных копий пришлось разложить */
  instances: number;
}

/** Рельеф узнаём по имени, которое ему даёт TerrainManager */
const TERRAIN_NAMES = ['terrain', 'dem-terrain'];

const isTerrain = (o: THREE.Object3D): boolean =>
  TERRAIN_NAMES.includes(o.name) || o.userData?.terrain === true;

/**
 * Собирает копию сцены, пригодную для выгрузки.
 *
 * Копия, а не сама сцена: раскладывать копии и выбрасывать служебное прямо в
 * живой сцене значило бы сломать её на глазах у человека.
 */
export function buildExportRoot(
  source: THREE.Object3D,
  opts: ExportOptions = {},
): { root: THREE.Object3D; triangles: number; instances: number } {
  const root = new THREE.Group();
  root.name = 'VOVPLAN';
  let triangles = 0;
  let instances = 0;

  const matrix = new THREE.Matrix4();

  const walk = (node: THREE.Object3D) => {
    if (node.userData?.[NO_EXPORT]) return;
    if (!node.visible) return;
    // Свет и камеры не выгружаем: в каждой программе своя постановка света,
    // а чужая только мешает
    if ((node as THREE.Light).isLight) return;
    if ((node as THREE.Camera).isCamera) return;
    if (node.type.endsWith('Helper')) return;
    if (!opts.includeTerrain && isTerrain(node)) return;

    const inst = node as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      instances += inst.count;
      inst.updateWorldMatrix(true, false);
      const triPerCopy = countTriangles(inst.geometry);

      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, matrix);
        const copy = new THREE.Mesh(inst.geometry, inst.material);
        // Матрица копии задана относительно самого InstancedMesh, поэтому
        // сначала ставим её, потом добавляем мировое положение носителя
        copy.applyMatrix4(matrix);
        copy.applyMatrix4(inst.matrixWorld);
        copy.name = `${inst.name || 'копия'}-${i}`;
        root.add(copy);
        triangles += triPerCopy;
      }
      return; // у аппаратных копий детей не бывает
    }

    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.updateWorldMatrix(true, false);
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.applyMatrix4(mesh.matrixWorld);
      copy.name = mesh.name || 'меш';
      root.add(copy);
      triangles += countTriangles(mesh.geometry);
    }

    for (const child of node.children) walk(child);
  };

  for (const child of source.children) walk(child);

  return { root, triangles, instances };
}

function countTriangles(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return geometry.index.count / 3;
  const position = geometry.getAttribute('position');
  return position ? position.count / 3 : 0;
}

/**
 * Выгружает сцену в GLB.
 *
 * Экспортёр работает в главном потоке и на большой сцене занимает секунды —
 * отсюда сообщения о ходе работы: без них выглядит как зависшая вкладка.
 */
export async function exportSceneToGlb(
  scene: THREE.Object3D,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const { onProgress } = opts;

  onProgress?.('Собираю сцену', 0.1);
  const { root, triangles, instances } = buildExportRoot(scene, opts);

  if (root.children.length === 0) {
    throw new Error('в сцене нечего выгружать');
  }

  onProgress?.('Готовлю файл', 0.4);
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('экспортёр вернул не двоичные данные'));
      },
      (err) => reject(err instanceof Error ? err : new Error('не удалось собрать GLB')),
      {
        binary: true,
        // Текстуры кладём как есть: пережатие в JPEG испортило бы карту
        // высот и подложку, а именно за ними человек и выгружает сцену
        maxTextureSize: 4096,
      },
    );
  });

  onProgress?.('Готово', 1);
  return { blob: new Blob([buffer], { type: 'model/gltf-binary' }), triangles, instances };
}

/** Отдаёт файл браузеру на скачивание */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Освобождаем не сразу: Firefox не успевает начать скачивание,
  // если ссылку отозвать в том же кадре
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Имя файла из названия проекта: «Чтиво2» → «Чтиво2-2026-08-11.glb» */
export function exportFileName(projectName: string): string {
  const safe = (projectName || 'сцена')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${safe}-${date}.glb`;
}
