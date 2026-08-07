/**
 * Запуск wasm-модуля вне браузера — для разработки.
 *
 * Тот же код и тот же интерфейс, что пойдёт во фронтенд, поэтому проверять
 * можно здесь, не поднимая сайт.
 *
 * Запуск:  node run.mjs <файл.dwg>
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const WASM = new URL('./target/wasm32-unknown-unknown/release/dwg_wasm.wasm', import.meta.url);

const file = process.argv[2];
if (!file) {
  console.log('Укажите файл: node run.mjs C:\\путь\\чертёж.dwg');
  process.exit(1);
}

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const api = instance.exports;

// Семя для хеш-таблиц внутри разбора — см. src/rng.rs
api.dwg_seed(webcrypto.getRandomValues(new BigUint64Array(1))[0]);

const bytes = readFileSync(file);
const ptr = api.dwg_alloc(bytes.length);
new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes);

const started = Date.now();
const out = api.dwg_probe(ptr, bytes.length);
const len = api.dwg_last_len();

// Копируем до освобождения: буфер памяти wasm мог переехать при росте кучи
const text = new TextDecoder().decode(
  new Uint8Array(api.memory.buffer, out, len).slice(),
);
api.dwg_free(out, len);

console.log(text);
console.log(`разбор занял ${((Date.now() - started) / 1000).toFixed(1)} с`);
