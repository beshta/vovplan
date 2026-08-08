/**
 * Сквозная проверка импорта DWG вне браузера.
 *
 * Повторяет ровно тот путь, что проходит файл на сайте: wasm разбирает чертёж,
 * дальше из деталей и копий собирается сцена и пакуется в GLB. Проверять это в
 * браузере неудобно — нужен вход, проект и ручная загрузка, — а сломаться тут
 * может каждое звено, и размер GLB заранее не угадать.
 *
 * Запуск:  node scripts/dwg-e2e.mjs <файл.dwg>
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Берём ровно ту копию, что уходит в сборку сайта, а не свежую из target/:
// именно расхождение между ними один раз и дало «Offset is outside the bounds
// of the DataView» — браузер читал новым разбором старый модуль.
const WASM = new URL('../src/wasm/dwg.wasm', import.meta.url);
const HEADER_BYTES = 28;

// GLTFExporter собирает двоичный кусок через FileReader — браузерный класс,
// которого в Node нет. Подменяем ровно тем, что экспортёру нужно: чтением
// Blob в ArrayBuffer.
if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const file = process.argv[2];
if (!file) {
  console.log('Укажите файл: node scripts/dwg-e2e.mjs C:\\путь\\чертёж.dwg');
  process.exit(1);
}

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const api = instance.exports;
api.dwg_seed(webcrypto.getRandomValues(new BigUint64Array(1))[0]);

const src = readFileSync(file);
const ptr = api.dwg_alloc(src.length);
new Uint8Array(api.memory.buffer, ptr, src.length).set(src);

const t0 = Date.now();
const out = api.dwg_convert(ptr, src.length);
const len = api.dwg_last_len();
const parseSecs = ((Date.now() - t0) / 1000).toFixed(1);

const tag = new TextDecoder().decode(new Uint8Array(api.memory.buffer, out, 4));
if (tag !== 'DWGM') {
  console.log('модуль вернул ошибку:', new TextDecoder().decode(new Uint8Array(api.memory.buffer, out + 4, len - 4)));
  process.exit(1);
}

// ── разбор буфера: тот же порядок, что в dwgWorker.ts ──
const hdr = new DataView(api.memory.buffer, out, HEADER_BYTES);
const partCount = hdr.getUint32(8, true);
const instCount = hdr.getUint32(12, true);
const view = new DataView(api.memory.buffer);

let at = out + HEADER_BYTES;
const parts = [];
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

const instances = [];
for (let i = 0; i < instCount; i++) {
  const part = view.getUint32(at, true);
  at += 4;
  const matrix = new Float32Array(12);
  for (let k = 0; k < 12; k++, at += 4) matrix[k] = view.getFloat32(at, true);
  instances.push({ part, matrix });
}
api.dwg_free(out, len);

// ── сборка сцены: тот же код, что в dwg.ts ──
const material = new THREE.MeshStandardMaterial({ color: 0xb8bec7, side: THREE.DoubleSide });
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
  m.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], 0, 0, 0, 1);
  mesh.applyMatrix4(m);
  root.add(mesh);
}
root.rotateX(-Math.PI / 2);
const box = new THREE.Box3().setFromObject(root);
const c = new THREE.Vector3();
box.getCenter(c);
root.position.set(-c.x, -box.min.y, -c.z);

const size = new THREE.Vector3();
box.getSize(size);
console.log(`деталей ${partCount}, копий ${instCount}, треугольников ${triangles.toLocaleString('ru')}`);
console.log(`габарит после разворота осей: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`);
console.log(`разбор ${parseSecs} с`);

// ── упаковка в GLB: главный неизвестный — размер ──
const t1 = Date.now();
const glb = await new Promise((resolve, reject) => {
  new GLTFExporter().parse(root, resolve, reject, { binary: true });
});
const mb = glb.byteLength / 1024 / 1024;
console.log(`GLB: ${mb.toFixed(1)} МБ за ${((Date.now() - t1) / 1000).toFixed(1)} с`);
console.log(mb < 100 ? '✅ проходит ограничение загрузки в 100 МБ' : '❌ не влезает в 100 МБ');
