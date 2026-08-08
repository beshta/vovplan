/**
 * Сборка модуля чертежей и доставка его во фронтенд.
 *
 * Отдельный скрипт нужен из-за одной конкретной ошибки: собранный `.wasm`
 * лежит в `target/`, а фронтенд подключает свою копию в `src/wasm/`. Стоит
 * поменять формат обмена и забыть скопировать — и браузер читает новым
 * разбором старый модуль. Наружу это выходит не понятной ошибкой, а мусором
 * вроде «Offset is outside the bounds of the DataView», по которому причину
 * не угадать.
 *
 * Запуск:  node build.mjs
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, 'target/wasm32-unknown-unknown/release/dwg_wasm.wasm');
const target = join(here, '../../packages/frontend/src/wasm/dwg.wasm');

console.log('собираю…');
try {
  execFileSync('cargo', ['build', '--release'], { cwd: here, stdio: 'inherit' });
} catch {
  console.error(
    '\nне вышло запустить cargo.\n' +
      'Rust стоит на диске E:, и переменные окружения задаются один раз:\n' +
      '  RUSTUP_HOME=E:\\rust\\rustup  CARGO_HOME=E:\\rust\\cargo\n' +
      '  PATH += E:\\rust\\cargo\\bin',
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(built, target);
console.log(`готово: ${(statSync(target).size / 1024 / 1024).toFixed(2)} МБ → src/wasm/dwg.wasm`);
