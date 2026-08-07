/**
 * Запуск wasm-модуля вне браузера — для разработки.
 *
 * Тот же код и тот же интерфейс, что пойдёт во фронтенд, поэтому проверять
 * можно здесь, не поднимая сайт.
 *
 *   node run.mjs <файл.dwg>            разбор в треугольники + сводка
 *   node run.mjs <файл.dwg> --probe    состав чертежа и поверхностей
 *   node run.mjs <файл.dwg> --obj out.obj   выгрузка для просмотра глазами
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const WASM = new URL('./target/wasm32-unknown-unknown/release/dwg_wasm.wasm', import.meta.url);

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.log('Укажите файл: node run.mjs C:\\путь\\чертёж.dwg');
  process.exit(1);
}
const probeOnly = rest.includes('--probe');
const objAt = rest.indexOf('--obj');
const objPath = objAt >= 0 ? rest[objAt + 1] : null;

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const api = instance.exports;

// Семя для хеш-таблиц внутри разбора — см. src/rng.rs
api.dwg_seed(webcrypto.getRandomValues(new BigUint64Array(1))[0]);

const bytes = readFileSync(file);
const ptr = api.dwg_alloc(bytes.length);
new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes);

const started = Date.now();
const out = probeOnly ? api.dwg_probe(ptr, bytes.length) : api.dwg_convert(ptr, bytes.length);
const len = api.dwg_last_len();
// Копируем до освобождения: буфер wasm мог переехать при росте кучи
const raw = new Uint8Array(api.memory.buffer, out, len).slice();
api.dwg_free(out, len);
const secs = ((Date.now() - started) / 1000).toFixed(1);

if (probeOnly) {
  console.log(new TextDecoder().decode(raw));
  console.log(`разбор занял ${secs} с`);
  process.exit(0);
}

const tag = new TextDecoder().decode(raw.subarray(0, 4));
if (tag === 'DWGE') {
  console.log('ошибка:', new TextDecoder().decode(raw.subarray(4)));
  process.exit(1);
}
if (tag !== 'DWGM') {
  console.log('неизвестный формат ответа:', tag);
  process.exit(1);
}

const view = new DataView(raw.buffer, raw.byteOffset);
const version = view.getUint32(4, true);
const verts = view.getUint32(8, true);
const bodiesOk = view.getUint32(12, true);
const bodiesFail = view.getUint32(16, true);
const skipped = view.getUint32(20, true);

const HEAD = 24;
const pos = new Float32Array(raw.buffer.slice(raw.byteOffset + HEAD, raw.byteOffset + HEAD + verts * 12));
const nrm = new Float32Array(
  raw.buffer.slice(raw.byteOffset + HEAD + verts * 12, raw.byteOffset + HEAD + verts * 24),
);

// Габарит — первый признак, что масштаб и оси не поехали
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
    if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
  }
}
const size = hi.map((h, i) => (h - lo[i]).toFixed(1));

console.log(`формат ${version} · тел разобрано ${bodiesOk}, не вышло ${bodiesFail}`);
console.log(`треугольников ${(verts / 3).toLocaleString('ru')}, граней пропущено ${skipped}`);
console.log(`габарит: ${size[0]} × ${size[1]} × ${size[2]}`);
console.log(`нормалей ${nrm.length / 3}, разбор занял ${secs} с`);

if (objPath) {
  const parts = [`# DWG → ${(verts / 3) | 0} треугольников\n`];
  for (let i = 0; i < pos.length; i += 3) {
    parts.push(`v ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}\n`);
  }
  for (let i = 0; i < verts; i += 3) {
    parts.push(`f ${i + 1} ${i + 2} ${i + 3}\n`);
  }
  writeFileSync(objPath, parts.join(''));
  console.log(`записано: ${objPath}`);
}
