/**
 * Проверка собранного модуля по поведению.
 *
 * Модуль строит внутри себя тело с известными размерами и прогоняет его через
 * ту же тесселяцию, что и настоящие чертежи. Здесь мы сверяем измеренное с
 * ожидаемым.
 *
 * Побайтовое сравнение `.wasm` для этой цели не годится: один исходник под
 * разными компиляторами даёт разные байты, предупреждение горело бы всегда, и
 * глаз бы к нему привык — ровно та слепота, от которой проверка и защищает.
 *
 * Запуск: node selftest.mjs [путь-к-wasm]
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const WASM =
  process.argv[2] ??
  new URL('./target/wasm32-unknown-unknown/release/dwg_wasm.wasm', import.meta.url);

/**
 * Ожидаемое для коробки, построенной как `build_box([0,0,0], 3, 5, 7)`.
 *
 * Шесть граней, по два треугольника на грань — коробка без скруглений режется
 * ровно так, и любое другое число означает поломку обхода граней.
 *
 * Габарит проверен опытом, а не выведен из подписей: у `build_box` на
 * вертикаль чертежа ложится второй аргумент, а не третий, поэтому в осях
 * сцены получается 3 × 5 × 7. Что сами развороты осей исправны, доказано на
 * настоящем чертеже: там габарит сошёлся с заголовком AutoCAD до метра
 * (29871 × 9745 × 10190 против 29871 × 9746 × 10190).
 */
const EXPECT = { faces: 6, triangles: 12, skipped: 0, size: [3, 5, 7] };
/** Допуск на размер: числа идут через f32, точное равенство требовать нельзя */
const TOL = 1e-4;

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const api = instance.exports;
api.dwg_seed(webcrypto.getRandomValues(new BigUint64Array(1))[0]);

const ptr = api.dwg_selftest();
const len = api.dwg_last_len();
const raw = new Uint8Array(api.memory.buffer, ptr, len).slice();
api.dwg_free(ptr, len);

const tag = new TextDecoder().decode(raw.subarray(0, 4));
if (tag !== 'DWGT') {
  console.error(`неожиданный ответ модуля: ${tag}`);
  process.exit(1);
}

const view = new DataView(raw.buffer, raw.byteOffset);
const got = {
  faces: view.getUint32(4, true),
  triangles: view.getUint32(8, true),
  skipped: view.getUint32(12, true),
  size: [view.getFloat32(16, true), view.getFloat32(20, true), view.getFloat32(24, true)],
};

const problems = [];
for (const key of ['faces', 'triangles', 'skipped']) {
  if (got[key] !== EXPECT[key]) problems.push(`${key}: ожидалось ${EXPECT[key]}, получено ${got[key]}`);
}
got.size.forEach((v, i) => {
  if (Math.abs(v - EXPECT.size[i]) > TOL) {
    problems.push(`размер по оси ${'XYZ'[i]}: ожидалось ${EXPECT.size[i]}, получено ${v.toFixed(4)}`);
  }
});

const sizeText = got.size.map((v) => v.toFixed(3)).join(' × ');
if (problems.length === 0) {
  console.log(`модуль в порядке: граней ${got.faces}, треугольников ${got.triangles}, габарит ${sizeText} м`);
  process.exit(0);
}

console.error('модуль ведёт себя не так, как ожидалось:');
for (const p of problems) console.error('  ' + p);
console.error(`\nполучено целиком: граней ${got.faces}, треугольников ${got.triangles}, пропущено ${got.skipped}, габарит ${sizeText}`);
console.error('Если поведение изменено намеренно — поправьте EXPECT в этом файле.');
process.exit(1);
