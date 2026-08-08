/**
 * Сравнение источников высот на конкретном участке.
 *
 * Текущий источник (AWS terrarium) — это модель первой отражающей поверхности:
 * в неё входят крыши и кроны. На городском участке «рельеф» из неё во многом
 * состоит из зданий, которые мы поверх этого ещё раз строим по данным OSM.
 *
 * GEDTM30 — модель голой земли под лицензией CC-BY, читается окном из
 * облачного GeoTIFF без скачивания всего файла (он на 402 ГБ).
 *
 * Скрипт берёт один и тот же участок из обоих источников и печатает профили:
 * если теория верна, у голой земли перепад будет заметно меньше.
 *
 * Запуск:  npx tsx scripts/dem-compare.mts <lat> <lng> <ширина_м> <высота_м>
 */
import { fromUrl } from 'geotiff';

const GEDTM30 =
  'https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif';

const lat = Number(process.argv[2] ?? 55.80712773273297);
const lng = Number(process.argv[3] ?? 37.58508145809174);
const widthM = Number(process.argv[4] ?? 199);
const heightM = Number(process.argv[5] ?? 240);

/** Границы участка в градусах */
const dLat = heightM / 111_320;
const dLng = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
const bbox = [lng - dLng / 2, lat - dLat / 2, lng + dLng / 2, lat + dLat / 2];
console.log(`участок ${widthM}×${heightM} м вокруг ${lat.toFixed(5)}, ${lng.toFixed(5)}`);

// ── источник 1: то, чем пользуемся сейчас ──
const zoom = 15;
const n = 2 ** zoom;
const tx = Math.floor(((lng + 180) / 360) * n);
const ty = Math.floor(
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
);
const tile = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`);
if (tile.ok) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(Buffer.from(await tile.arrayBuffer()))
    .raw()
    .toBuffer({ resolveWithObject: true });
  // terrarium: высота = R*256 + G + B/256 − 32768
  const h = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
  };
  // Тайл 256 пкс покрывает больше участка — берём его центральную часть
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / n;
  const half = Math.max(2, Math.round(widthM / mPerPx / 2));
  const cx = 128;
  const cy = 128;
  const vals: number[] = [];
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      if (x >= 0 && y >= 0 && x < info.width && y < info.height) vals.push(h(x, y));
    }
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  console.log(`\nterrarium (крыши и кроны включены), ${mPerPx.toFixed(1)} м/пкс:`);
  console.log(`  высоты ${lo.toFixed(1)}…${hi.toFixed(1)} м, перепад ${(hi - lo).toFixed(1)} м`);
  const row: string[] = [];
  for (let x = cx - half; x <= cx + half; x++) row.push(h(x, cy).toFixed(1));
  console.log(`  профиль: ${row.join(' ')}`);
} else {
  console.log('terrarium: тайл не отдался,', tile.status);
}

// ── источник 2: голая земля ──
const tiff = await fromUrl(GEDTM30);
const image = await tiff.getImage();
const [ox, oy] = image.getOrigin();
const [rx, ry] = image.getResolution();
const px = (lonlat: number, origin: number, res: number) => Math.round((lonlat - origin) / res);
const x0 = px(bbox[0], ox, rx);
const x1 = px(bbox[2], ox, rx);
const y0 = px(bbox[3], oy, ry);
const y1 = px(bbox[1], oy, ry);

const win = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1) + 1, Math.max(y0, y1) + 1];
const started = Date.now();
const [band] = (await image.readRasters({ window: win })) as unknown as Float32Array[];
const w = win[2] - win[0];
const vals = Array.from(band).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e30);
const lo = Math.min(...vals);
const hi = Math.max(...vals);
console.log(`\nGEDTM30 (голая земля), окно ${w}×${(win[3] - win[1])} пкс за ${Date.now() - started} мс:`);
console.log(`  высоты ${lo.toFixed(1)}…${hi.toFixed(1)} м, перепад ${(hi - lo).toFixed(1)} м`);
const mid = Math.floor((win[3] - win[1]) / 2);
console.log(
  `  профиль: ${Array.from(band.slice(mid * w, mid * w + w))
    .map((v) => v.toFixed(1))
    .join(' ')}`,
);

// ── источник 3: Copernicus GLO-30, самый точный из открытых DSM ──
// Имя плитки: широта двумя цифрами, долгота тремя — иначе 404
const cell = (v: number, p: string, n: string, digits: number) =>
  `${v < 0 ? n : p}${String(Math.floor(Math.abs(v))).padStart(digits, '0')}`;
const name = `Copernicus_DSM_COG_10_${cell(lat, 'N', 'S', 2)}_00_${cell(lng, 'E', 'W', 3)}_00_DEM`;
const copURL = `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
try {
  const cop = await fromUrl(copURL);
  const ci = await cop.getImage();
  const [cox, coy] = ci.getOrigin();
  const [crx, cry] = ci.getResolution();
  const cx0 = Math.round((bbox[0] - cox) / crx);
  const cx1 = Math.round((bbox[2] - cox) / crx);
  const cy0 = Math.round((bbox[3] - coy) / cry);
  const cy1 = Math.round((bbox[1] - coy) / cry);
  const cwin = [Math.min(cx0, cx1), Math.min(cy0, cy1), Math.max(cx0, cx1) + 1, Math.max(cy0, cy1) + 1];
  const [cband] = (await ci.readRasters({ window: cwin })) as unknown as Float32Array[];
  const cvals = Array.from(cband).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e30);
  const cw = cwin[2] - cwin[0];
  console.log(`\nCopernicus GLO-30 (крыши включены), окно ${cw}×${cwin[3] - cwin[1]} пкс:`);
  console.log(
    `  высоты ${Math.min(...cvals).toFixed(1)}…${Math.max(...cvals).toFixed(1)} м, перепад ${(
      Math.max(...cvals) - Math.min(...cvals)
    ).toFixed(1)} м`,
  );
  const cmid = Math.floor((cwin[3] - cwin[1]) / 2);
  console.log(
    `  профиль: ${Array.from(cband.slice(cmid * cw, cmid * cw + cw))
      .map((v) => v.toFixed(1))
      .join(' ')}`,
  );
} catch (e) {
  console.log(`\nCopernicus: не вышло — ${(e as Error).message}`);
  console.log(`  пробовал ${copURL}`);
}
