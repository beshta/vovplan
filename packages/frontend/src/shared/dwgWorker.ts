/// <reference lib="webworker" />
import wasmUrl from '../wasm/dwg.wasm?url';

/**
 * Разбор чертежей в отдельном потоке.
 *
 * Чертёж на пару мегабайт разворачивается в миллионы треугольников, и разбор
 * занимает секунды. В главном потоке это замораживает вкладку: браузер решает,
 * что страница зависла, и отбирает у неё контекст WebGL — 3D-сцена гаснет
 * прямо во время загрузки модели.
 *
 * Здесь же поток свой, и главному остаётся только принять готовые буферы.
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

/** Длина заголовка ответа: метка и шесть счётчиков */
const HEADER_BYTES = 28;

let loading: Promise<DwgModule> | null = null;

function load(): Promise<DwgModule> {
  // Модуль без состояния между вызовами, поэтому одного экземпляра хватает
  // на всю жизнь потока, и повторная загрузка мегабайта не нужна
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

export interface DwgStats {
  bodiesOk: number;
  bodiesFailed: number;
  facesSkipped: number;
  /** Треугольников в самих деталях, без учёта повторов */
  triangles: number;
  parts: number;
  instances: number;
}

/** Геометрия одной детали чертежа */
export interface DwgPart {
  positions: ArrayBuffer;
  normals: ArrayBuffer;
}

/** Копия детали: номер и матрица 3×4 построчно, сдвиг последним столбцом */
export interface DwgInstance {
  part: number;
  matrix: Float32Array;
}

/** Сообщения назад в главный поток */
export type DwgReply =
  | { kind: 'stage'; text: string }
  | { kind: 'done'; parts: DwgPart[]; instances: DwgInstance[]; stats: DwgStats }
  | { kind: 'error'; message: string };

const post = (msg: DwgReply, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    post({ kind: 'stage', text: 'Загружаю модуль чертежей...' });
    const api = await load();

    post({ kind: 'stage', text: 'Читаю чертёж...' });
    const input = new Uint8Array(e.data);
    const ptr = api.dwg_alloc(input.length);
    if (!ptr) throw new Error('не хватило памяти под файл');
    new Uint8Array(api.memory.buffer, ptr, input.length).set(input);

    // Владение буфером переходит внутрь модуля — освобождать его тут не нужно
    const out = api.dwg_convert(ptr, input.length);
    const len = api.dwg_last_len();
    if (!out || len < 4) throw new Error('разбор не дал результата');

    const head = new Uint8Array(api.memory.buffer, out, 4);
    const tag = String.fromCharCode(head[0], head[1], head[2], head[3]);
    if (tag === 'DWGE') {
      const msg = new TextDecoder().decode(
        new Uint8Array(api.memory.buffer, out + 4, len - 4),
      );
      api.dwg_free(out, len);
      throw new Error(msg);
    }
    if (tag !== 'DWGM') {
      api.dwg_free(out, len);
      throw new Error('неожиданный ответ модуля чертежей');
    }

    const hdr = new DataView(api.memory.buffer, out, HEADER_BYTES);
    const partCount = hdr.getUint32(8, true);
    const instCount = hdr.getUint32(12, true);

    post({ kind: 'stage', text: 'Собираю модель...' });

    // Детали идут подряд: у каждой число вершин, координаты, нормали.
    // Режем прямо из памяти модуля и сразу отдаём владение главному потоку —
    // лишняя копия здесь стоила бы паузы и всплеска памяти.
    const view = new DataView(api.memory.buffer);
    let at = out + HEADER_BYTES;
    const parts: DwgPart[] = [];
    let triangles = 0;
    for (let i = 0; i < partCount; i++) {
      const verts = view.getUint32(at, true);
      at += 4;
      const bytes = verts * 12;
      parts.push({
        positions: api.memory.buffer.slice(at, at + bytes),
        normals: api.memory.buffer.slice(at + bytes, at + bytes * 2),
      });
      at += bytes * 2;
      triangles += verts / 3;
    }

    const instances: DwgInstance[] = [];
    for (let i = 0; i < instCount; i++) {
      const part = view.getUint32(at, true);
      at += 4;
      const matrix = new Float32Array(12);
      for (let k = 0; k < 12; k++, at += 4) matrix[k] = view.getFloat32(at, true);
      instances.push({ part, matrix });
    }

    const stats: DwgStats = {
      bodiesOk: hdr.getUint32(16, true),
      bodiesFailed: hdr.getUint32(20, true),
      facesSkipped: hdr.getUint32(24, true),
      triangles,
      parts: partCount,
      instances: instCount,
    };
    api.dwg_free(out, len);

    if (triangles === 0) throw new Error('в чертеже не нашлось объёмной геометрии');

    post(
      { kind: 'done', parts, instances, stats },
      parts.flatMap((p) => [p.positions, p.normals]),
    );
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
  }
};
