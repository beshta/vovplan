/**
 * Разведка содержимого DWG.
 *
 * Отвечает на единственный вопрос, от которого зависит вся дальнейшая работа:
 * можно ли вытащить из ваших файлов 3D-геометрию бесплатным LibreDWG, или там
 * ACIS-тела, для которых нужен платный ODA SDK.
 *
 * Запуск:  node inspect.mjs <папка-или-файл.dwg> [ещё файлы...]
 *
 * Это внутренний инструмент, не часть продукта: LibreDWG под GPL-3, поэтому
 * пакет живёт вне рабочих пакетов и не попадает ни в бандл, ни в Docker-образ.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

/** Что из этого можно превратить в 3D-модель */
const GEOMETRY_3D = new Set(['3DFACE', 'POLYLINE_MESH', 'POLYLINE_PFACE', 'MESH', 'POLYLINE_3D']);
/** Данные ACIS: LibreDWG их видит, но раскодировать не может — нужен ODA */
const ACIS = new Set(['3DSOLID', 'REGION', 'BODY', 'SURFACE', 'PLANESURFACE', 'EXTRUDEDSURFACE', 'REVOLVEDSURFACE']);

function collectFiles(paths) {
  const out = [];
  for (const p of paths) {
    if (!statSync(p).isDirectory()) {
      if (extname(p).toLowerCase() === '.dwg') out.push(p);
      continue;
    }
    for (const f of readdirSync(p)) {
      const full = join(p, f);
      if (statSync(full).isFile() && extname(f).toLowerCase() === '.dwg') out.push(full);
    }
  }
  return out;
}

/** Считаем сущности и в модели, и внутри блоков — вложенное тоже важно */
function countEntities(db) {
  const counts = new Map();
  const bump = (t) => counts.set(t, (counts.get(t) ?? 0) + 1);

  for (const e of db?.entities ?? []) bump(e.type ?? 'НЕИЗВЕСТНО');
  for (const b of db?.blocks ?? []) {
    for (const e of b.entities ?? []) bump(e.type ?? 'НЕИЗВЕСТНО');
  }
  return counts;
}

function verdict(counts) {
  let d3 = 0, acis = 0, flat = 0;
  for (const [type, n] of counts) {
    if (GEOMETRY_3D.has(type)) d3 += n;
    else if (ACIS.has(type)) acis += n;
    else flat += n;
  }
  let text;
  if (d3 > 0 && acis === 0) text = '✅ 3D читается полностью — LibreDWG справится';
  else if (d3 > 0 && acis > 0) text = '⚠️  частично: часть объёма в ACIS и не откроется';
  else if (acis > 0) text = '❌ объём только в ACIS — без ODA SDK не выйдет';
  else if (flat > 0) text = '📐 плоский чертёж: 3D-модели нет, но линии наложить на рельеф можно';
  else text = '❔ пусто или не разобралось';
  return { d3, acis, flat, text };
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Укажите папку с файлами DWG или сами файлы:\n  node inspect.mjs C:\\путь\\к\\чертежам');
  process.exit(1);
}

const files = collectFiles(args);
if (files.length === 0) {
  console.log('Файлов .dwg не найдено.');
  process.exit(1);
}

const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
console.log(`Проверяю файлов: ${files.length}\n`);

const total = { d3: 0, acis: 0, flat: 0, ok: 0, partial: 0, blocked: 0, flatOnly: 0, failed: 0 };

for (const file of files) {
  const name = basename(file);
  try {
    const buf = readFileSync(file);
    const ptr = libredwg.dwg_read_data(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      Dwg_File_Type.DWG,
    );
    if (!ptr) throw new Error('не удалось прочитать (возможно, слишком новая версия)');

    const db = libredwg.convert(ptr);
    const counts = countEntities(db);
    const v = verdict(counts);
    libredwg.dwg_free(ptr);

    total.d3 += v.d3; total.acis += v.acis; total.flat += v.flat;
    if (v.text.startsWith('✅')) total.ok++;
    else if (v.text.startsWith('⚠')) total.partial++;
    else if (v.text.startsWith('❌')) total.blocked++;
    else total.flatOnly++;

    console.log(`${name}`);
    console.log(`   ${v.text}`);
    console.log(`   3D-грани: ${v.d3} · ACIS-тела: ${v.acis} · плоские: ${v.flat}`);
    // Показываем состав — помогает понять, что за чертёж
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([t, n]) => `${t}×${n}`).join(', ');
    console.log(`   состав: ${top}\n`);
  } catch (err) {
    total.failed++;
    console.log(`${name}\n   ❌ ошибка: ${err.message}\n`);
  }
}

console.log('─'.repeat(60));
console.log('ИТОГО ПО ФАЙЛАМ');
console.log(`  полностью читаются в 3D:      ${total.ok}`);
console.log(`  частично (есть ACIS):          ${total.partial}`);
console.log(`  только ACIS — нужен ODA:       ${total.blocked}`);
console.log(`  плоские чертежи:               ${total.flatOnly}`);
console.log(`  не прочитались:                ${total.failed}`);
console.log(`\nОБЪЕКТОВ: 3D-граней ${total.d3} · ACIS-тел ${total.acis} · плоских ${total.flat}`);

const needOda = total.blocked + total.partial;
console.log('\nВЫВОД:');
if (needOda === 0) {
  console.log('  LibreDWG покрывает ваши файлы. Платить ODA не нужно.');
} else if (needOda >= files.length / 2) {
  console.log(`  ACIS встречается в ${needOda} из ${files.length} файлов — это больше половины.`);
  console.log('  Бесплатный путь закроет меньшую часть; стоит считать экономику ODA SDK.');
} else {
  console.log(`  ACIS встречается в ${needOda} из ${files.length} файлов.`);
  console.log('  Разумно начать с LibreDWG и честно сообщать про остальные.');
}
