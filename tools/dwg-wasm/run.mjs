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
const partCount = view.getUint32(8, true);
const instCount = view.getUint32(12, true);
const bodiesOk = view.getUint32(16, true);
const bodiesFail = view.getUint32(20, true);
const skipped = view.getUint32(24, true);
const mmPerUnit = view.getUint32(28, true);

// Детали идут подряд: у каждой число вершин, координаты, нормали
let at = 32;
const parts = [];
let triangles = 0;
for (let i = 0; i < partCount; i++) {
  const verts = view.getUint32(at, true);
  at += 4;
  const pos = new Float32Array(raw.buffer.slice(raw.byteOffset + at, raw.byteOffset + at + verts * 12));
  at += verts * 12;
  at += verts * 12; // нормали здесь не нужны
  parts.push(pos);
  triangles += verts / 3;
}

// Копии: номер детали и матрица 3×4
const instances = [];
for (let i = 0; i < instCount; i++) {
  const part = view.getUint32(at, true);
  at += 4;
  const m = [];
  for (let k = 0; k < 12; k++, at += 4) m.push(view.getFloat32(at, true));
  instances.push({ part, m });
}

// Габарит по расставленным копиям — первый признак, что оси не поехали
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
const place = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];
for (const { part, m } of instances) {
  const pos = parts[part];
  for (let i = 0; i < pos.length; i += 3) {
    const w = place(m, [pos[i], pos[i + 1], pos[i + 2]]);
    for (let k = 0; k < 3; k++) {
      if (w[k] < lo[k]) lo[k] = w[k];
      if (w[k] > hi[k]) hi[k] = w[k];
    }
  }
}
const size = hi.map((h, i) => (h - lo[i]).toFixed(1));

const payload = 28 + triangles * 72 + instCount * 52;
console.log(`формат ${version} · тел разобрано ${bodiesOk}, не вышло ${bodiesFail}`);
console.log(`единицы: ${mmPerUnit} мм на юнит чертежа`);
console.log(
  `деталей ${partCount.toLocaleString('ru')}, копий ${instCount.toLocaleString('ru')}, граней пропущено ${skipped}`,
);
console.log(
  `треугольников в деталях ${triangles.toLocaleString('ru')} (при разворачивании копий было бы ${(
    instances.reduce((s, { part }) => s + parts[part].length / 9, 0)
  ).toLocaleString('ru')})`,
);
console.log(`габарит: ${size[0]} × ${size[1]} × ${size[2]}`);
console.log(`объём данных: ${(payload / 1024 / 1024).toFixed(1)} МБ, разбор занял ${secs} с`);

if (objPath) {
  const out = [`# DWG → ${partCount} деталей, ${instCount} копий\n`];
  let base = 1;
  for (const { part, m } of instances) {
    const pos = parts[part];
    for (let i = 0; i < pos.length; i += 3) {
      const w = place(m, [pos[i], pos[i + 1], pos[i + 2]]);
      out.push(`v ${w[0]} ${w[1]} ${w[2]}\n`);
    }
    for (let i = 0; i < pos.length / 3; i += 3) {
      out.push(`f ${base + i} ${base + i + 1} ${base + i + 2}\n`);
    }
    base += pos.length / 3;
  }
  writeFileSync(objPath, out.join(''));
  console.log(`записано: ${objPath}`);
}
