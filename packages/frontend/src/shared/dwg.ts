import * as THREE from 'three';
import type { DwgInstance, DwgPart, DwgReply, DwgStats } from './dwgWorker';

/**
 * Чтение чертежей AutoCAD в браузере.
 *
 * DWG закрыт, и объём в нём хранится телами ACIS — границей из поверхностей,
 * а не готовой сеткой. Разбор и разрез на треугольники живут в отдельном
 * модуле на Rust (`tools/dwg-wasm`), здесь только сборка сетки из готовых
 * буферов.
 *
 * Сам разбор идёт в рабочем потоке: он занимает секунды, и в главном потоке
 * успевал заморозить вкладку до потери контекста WebGL.
 */

export type { DwgStats };

/**
 * Разбирает DWG и собирает из него сетку.
 *
 * Модель ставится основанием в ноль и центрируется по горизонтали: чертежи
 * обычно лежат в геодезических координатах за сотни километров от начала
 * отсчёта, и без переноса объект оказался бы далеко за пределами сцены.
 */
export async function parseDwg(
  buffer: ArrayBuffer,
  onStage?: (text: string) => void,
): Promise<{ object: THREE.Object3D; stats: DwgStats }> {
  const worker = new Worker(new URL('./dwgWorker.ts', import.meta.url), {
    type: 'module',
  });

  try {
    const { parts, instances, stats } = await new Promise<{
      parts: DwgPart[];
      instances: DwgInstance[];
      stats: DwgStats;
    }>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<DwgReply>) => {
        const msg = e.data;
        if (msg.kind === 'stage') onStage?.(msg.text);
        else if (msg.kind === 'done') resolve(msg);
        else reject(new Error(msg.message));
      };
      // Поток может умереть и молча — например, если модулю не хватит памяти
      worker.onerror = () => reject(new Error('поток разбора чертежей упал'));
      // Файл отдаём вместе с владением: копировать мегабайты незачем
      worker.postMessage(buffer, [buffer]);
    });

    const material = new THREE.MeshStandardMaterial({
      color: 0xb8bec7,
      roughness: 0.75,
      metalness: 0.05,
      // Чертёж описывает поверхности телами, но встречаются и одиночные грани
      // без объёма: без двусторонней отрисовки они пропадают под углом
      side: THREE.DoubleSide,
    });

    // Геометрия детали создаётся один раз и переиспользуется всеми её копиями.
    // Это не мелкая экономия: в проверочном чертеже 485 деталей и 14 812 копий,
    // и развёрнутые копии дали бы два миллиона треугольников вместо семидесяти
    // тысяч. Экспорт в GLB такие общие геометрии тоже записывает один раз.
    const geometries = parts.map(({ positions, normals }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
      return g;
    });

    const root = new THREE.Group();
    const m = new THREE.Matrix4();
    for (const { part, matrix: r } of instances) {
      const mesh = new THREE.Mesh(geometries[part], material);
      // Матрица приходит построчно, сдвиг — последним столбцом
      m.set(
        r[0], r[1], r[2], r[3],
        r[4], r[5], r[6], r[7],
        r[8], r[9], r[10], r[11],
        0, 0, 0, 1,
      );
      mesh.applyMatrix4(m);
      root.add(mesh);
    }

    // В чертеже вертикаль — это Z, в сцене — Y. Разворот делается здесь, на
    // собранной модели: детали и матрицы копий живут в осях чертежа, и
    // повернуть их поодиночке значило бы рассогласовать одно с другим.
    root.rotateX(-Math.PI / 2);

    // Ставим основанием на ноль и центрируем по горизонтали — так модель
    // предсказуемо ложится на рельеф, куда бы её ни поместили
    const box = new THREE.Box3().setFromObject(root);
    const c = new THREE.Vector3();
    box.getCenter(c);
    root.position.set(-c.x, -box.min.y, -c.z);

    return { object: root, stats };
  } finally {
    // Поток одноразовый: держать его ради следующего файла незачем,
    // а мегабайты его памяти освобождаются сразу
    worker.terminate();
  }
}
