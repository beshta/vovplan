import * as THREE from 'three';
import wasmUrl from '../wasm/dwg.wasm?url';

/**
 * Чтение чертежей AutoCAD в браузере.
 *
 * DWG закрыт, и объём в нём хранится телами ACIS — границей из поверхностей,
 * а не готовой сеткой. Разбор и разрез на треугольники живут в отдельном
 * модуле на Rust (`tools/dwg-wasm`), здесь только обмен буферами с ним.
 *
 * Модуль весит больше мегабайта и грузится по требованию: тот, кто чертежей
 * не открывает, за него не платит весом страницы.
 */

/** Что модуль отдаёт наружу — голый C-ABI, без обвязки wasm-bindgen */
interface DwgModule {
  memory: WebAssembly.Memory;
  dwg_seed(seed: bigint): void;
  dwg_alloc(len: number): number;
  dwg_free(ptr: number, len: number): void;
  dwg_last_len(): number;
  dwg_convert(ptr: number, len: number): number;
}

/** Длина заголовка ответа: метка и пять счётчиков */
const HEADER_BYTES = 24;

let loading: Promise<DwgModule> | null = null;

function load(): Promise<DwgModule> {
  // Модуль без состояния между вызовами, поэтому одного экземпляра хватает
  // на всю сессию, и повторная загрузка мегабайта не нужна
  loading ??= WebAssembly.instantiateStreaming(fetch(wasmUrl), {})
    .catch(async () => {
      // Некоторые серверы отдают .wasm с неверным типом содержимого,
      // и потоковая сборка на этом падает
      const bytes = await (await fetch(wasmUrl)).arrayBuffer();
      return WebAssembly.instantiate(bytes, {});
    })
    .then(({ instance }) => {
      const api = instance.exports as unknown as DwgModule;
      // Семя для хеш-таблиц внутри разбора. Ключи там берутся из читаемого
      // файла, то есть из недоверенных данных: с постоянным семенем файл
      // можно собрать так, чтобы разбор захлебнулся на коллизиях.
      api.dwg_seed(crypto.getRandomValues(new BigUint64Array(1))[0]);
      return api;
    })
    .catch((err) => {
      loading = null; // дать следующей попытке шанс
      throw err;
    });
  return loading;
}

/** Итог разбора: сколько получилось и сколько честно потеряно */
export interface DwgStats {
  bodiesOk: number;
  bodiesFailed: number;
  facesSkipped: number;
  triangles: number;
}

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
  onStage?.('Загружаю модуль чертежей...');
  const api = await load();

  onStage?.('Читаю чертёж...');
  const input = new Uint8Array(buffer);
  const ptr = api.dwg_alloc(input.length);
  if (!ptr) throw new Error('не хватило памяти под файл');
  new Uint8Array(api.memory.buffer, ptr, input.length).set(input);

  // Владение буфером переходит внутрь модуля — освобождать его тут не нужно
  const out = api.dwg_convert(ptr, input.length);
  const len = api.dwg_last_len();
  if (!out || len < 4) throw new Error('разбор не дал результата');

  // Копия обязательна до освобождения: память модуля могла переехать,
  // когда куча росла во время разбора
  const raw = new Uint8Array(api.memory.buffer, out, len).slice();
  api.dwg_free(out, len);

  const tag = String.fromCharCode(...raw.subarray(0, 4));
  if (tag === 'DWGE') {
    throw new Error(new TextDecoder().decode(raw.subarray(4)));
  }
  if (tag !== 'DWGM') throw new Error('неожиданный ответ модуля чертежей');

  const view = new DataView(raw.buffer, raw.byteOffset);
  const vertices = view.getUint32(8, true);
  const stats: DwgStats = {
    bodiesOk: view.getUint32(12, true),
    bodiesFailed: view.getUint32(16, true),
    facesSkipped: view.getUint32(20, true),
    triangles: vertices / 3,
  };
  if (vertices === 0) throw new Error('в чертеже не нашлось объёмной геометрии');

  onStage?.('Собираю модель...');
  const floats = vertices * 3;
  const base = raw.byteOffset + HEADER_BYTES;
  // Копируем в собственные массивы: raw переиспользоваться не будет,
  // но держать за ним весь буфер ответа накладно
  const positions = new Float32Array(raw.buffer.slice(base, base + floats * 4));
  const normals = new Float32Array(
    raw.buffer.slice(base + floats * 4, base + floats * 8),
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  // Ставим основанием на ноль и центрируем по горизонтали — так модель
  // предсказуемо ложится на рельеф, куда бы её ни поместили
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const c = new THREE.Vector3();
    box.getCenter(c);
    geometry.translate(-c.x, -box.min.y, -c.z);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xb8bec7,
    roughness: 0.75,
    metalness: 0.05,
    // Чертёж описывает поверхности телами, но встречаются и одиночные грани
    // без объёма: без двусторонней отрисовки они пропадают под углом
    side: THREE.DoubleSide,
  });

  return { object: new THREE.Mesh(geometry, material), stats };
}
