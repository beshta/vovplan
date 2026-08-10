/**
 * Разбор конкретного чертежа с полным отчётом.
 *
 * Приложение о неудаче говорит одной фразой — «в чертеже не нашлось объёмной
 * геометрии», — и по ней нельзя отличить три совершенно разные беды:
 * файл не прочитался вовсе; тела нашлись, но ни одно не разобралось; тела
 * разобрались, но тесселяция ничего не дала. Здесь видно, что именно
 * произошло, без браузера и без пересборки модуля.
 *
 * Запуск: node diag.mjs путь-к-чертежу.dwg [путь-к-wasm]
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const dwgPath = process.argv[2];
if (!dwgPath) {
  console.error('Укажите путь к чертежу: node diag.mjs файл.dwg [файл.wasm]');
  process.exit(2);
}

// По умолчанию берём тот же модуль, что работает в приложении, а не свежую
// сборку: разбираемся именно с тем, на чём споткнулся пользователь
const wasmPath =
  process.argv[3] ?? new URL('../../packages/frontend/src/wasm/dwg.wasm', import.meta.url);

const HEADER_BYTES = 32;
const MB = 1024 * 1024;
const mb = (bytes) => (bytes / MB).toFixed(1);

const file = readFileSync(dwgPath);
console.log(`Чертёж: ${dwgPath} — ${mb(file.length)} МБ`);

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const api = instance.exports;
api.dwg_seed(webcrypto.getRandomValues(new BigUint64Array(1))[0]);

const ptr = api.dwg_alloc(file.length);
if (!ptr) {
  console.error('Не хватило памяти под файл: модуль не смог выделить буфер.');
  process.exit(1);
}
new Uint8Array(api.memory.buffer, ptr, file.length).set(file);

const started = Date.now();
let out;
try {
  // Владение буфером уходит внутрь модуля — освобождать его здесь не нужно
  out = api.dwg_convert(ptr, file.length);
} catch (err) {
  // Ловушка в wasm — обычно это выход за память на большом файле
  console.error(`Модуль упал на разборе: ${err.message}`);
  console.error(`Память модуля к этому моменту: ${mb(api.memory.buffer.byteLength)} МБ`);
  process.exit(1);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const len = api.dwg_last_len();
console.log(`Разбор занял ${seconds} с, память модуля ${mb(api.memory.buffer.byteLength)} МБ`);

if (!out || len < 4) {
  console.error('Разбор не дал результата: модуль вернул пустой ответ.');
  process.exit(1);
}

const head = new Uint8Array(api.memory.buffer, out, 4);
const tag = String.fromCharCode(...head);

if (tag === 'DWGE') {
  const msg = new TextDecoder().decode(new Uint8Array(api.memory.buffer, out + 4, len - 4));
  console.error(`\nМодуль отказался: ${msg}`);
  console.error(
    '\nЕсли сказано «не нашлось объёмной геометрии» — обход видел только тела ACIS\n' +
      '(3DSOLID, REGION, BODY) и вставки блоков. Сетки (MESH, POLYFACE), поверхности\n' +
      'и прокси-объекты он пропускает молча. Проверьте в AutoCAD, чем сделан объём.',
  );
  process.exit(1);
}

if (tag !== 'DWGM') {
  console.error(`Неожиданная метка ответа: ${tag}`);
  process.exit(1);
}

const hdr = new DataView(api.memory.buffer, out, HEADER_BYTES);
const parts = hdr.getUint32(8, true);
const instances = hdr.getUint32(12, true);

// Детали идут подряд: у каждой число вершин, координаты, нормали
let at = out + HEADER_BYTES;
let triangles = 0;
const view = new DataView(api.memory.buffer);
/** Габарит каждой детали в её собственных осях — из него соберём мировой */
const bounds = [];
for (let i = 0; i < parts; i++) {
  const verts = view.getUint32(at, true);
  at += 4;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < verts; v++) {
    for (let k = 0; k < 3; k++) {
      const c = view.getFloat32(at + (v * 3 + k) * 4, true);
      if (c < lo[k]) lo[k] = c;
      if (c > hi[k]) hi[k] = c;
    }
  }
  bounds.push({ lo, hi });
  at += verts * 24;
  triangles += verts / 3;
}

/*
 * Габарит всей сборки — главная проверка правильности.
 *
 * Ошибка в матрицах вставок не меняет ни числа треугольников, ни числа тел:
 * модель разберётся «успешно» и окажется размазанной на километры или
 * схлопнутой в точку. Видно это только по размеру, поэтому его и печатаем —
 * сверять с тем, что показывает AutoCAD.
 */
const world = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < instances; i++) {
  const part = view.getUint32(at, true);
  at += 4;
  const m = [];
  for (let k = 0; k < 12; k++, at += 4) m.push(view.getFloat32(at, true));
  const b = bounds[part];
  if (!b || b.lo[0] === Infinity) continue;
  // Восемь углов коробки детали, переведённые матрицей копии
  for (let corner = 0; corner < 8; corner++) {
    const p = [
      corner & 1 ? b.hi[0] : b.lo[0],
      corner & 2 ? b.hi[1] : b.lo[1],
      corner & 4 ? b.hi[2] : b.lo[2],
    ];
    for (let row = 0; row < 3; row++) {
      const c = m[row * 4] * p[0] + m[row * 4 + 1] * p[1] + m[row * 4 + 2] * p[2] + m[row * 4 + 3];
      if (c < world.lo[row]) world.lo[row] = c;
      if (c > world.hi[row]) world.hi[row] = c;
    }
  }
}
const size = world.hi.map((h, k) => h - world.lo[k]);

console.log(`
Версия формата ответа: ${hdr.getUint32(4, true)}
Деталей (уникальных геометрий): ${parts}
Копий в сцене:                  ${instances}
Тел разобрано:                  ${hdr.getUint32(16, true)}
Тел не поддалось:               ${hdr.getUint32(20, true)}
Граней пропущено:               ${hdr.getUint32(24, true)}
Миллиметров на юнит чертежа:    ${hdr.getUint32(28, true)}
Треугольников в деталях:        ${triangles}
Габарит сборки (X × Y × Z):     ${size.map((v) => v.toFixed(1)).join(' × ')} м
  (в чертеже вертикаль — Z; в сцене она станет Y)`);

api.dwg_free(out, len);

if (triangles === 0) {
  console.error('\nГеометрия пустая: тела нашлись, но тесселяция не дала ни одного треугольника.');
  process.exit(1);
}
