import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

// Файловый кэш тайлов: они иммутабельны (фиксированные z/x/y), поэтому
// кэшируются вечно. Импорт перестаёт зависеть от перегрузки OSM/DEM/Overpass.
const TILE_CACHE_DIR = join(process.cwd(), '.tilecache');
try { mkdirSync(TILE_CACHE_DIR, { recursive: true }); } catch { /* уже есть */ }

function cachePath(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex');
  return join(TILE_CACHE_DIR, `${hash}.bin`);
}

/**
 * Импорт реального рельефа по полигону, нарисованному на карте.
 *
 * Источники (открытые, без API-ключей):
 * - DEM: AWS Terrain Tiles (terrarium) — глобальный рельеф ~30м/пиксель,
 *   высота кодируется в RGB: h = R*256 + G + B/256 - 32768 (метры).
 * - Текстура: Esri World Imagery (спутниковые тайлы).
 *
 * Алгоритм: bbox полигона → slippy-тайлы нужного зума → склейка →
 * вырезка точного bbox → grayscale heightmap PNG + спутниковая текстура
 * с затемнением за пределами полигона («вырезанный» участок).
 */

const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ESRI_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
// Схема OpenStreetMap (дороги, реки, здания) — дефолтная текстура, читаемее спутника
const OSM_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const TILE = 256;
/**
 * Лимиты тайлов на запрос (защита от гигантских областей).
 * Выше лимит = детальнее для больших площадок (держат более высокий зум),
 * ценой времени скачивания и памяти при склейке.
 *
 * У рельефа и текстуры бюджеты разные: terrarium выше z15 новых данных не
 * даёт, а тайлы карты полезны до z19 — там прирост детализации реальный,
 * поэтому текстуре бюджет заметно больше.
 */
const MAX_TILES_DEM = 120;
const MAX_TILES_TEX = 420;
/** Потолок зума источников: terrarium — z15, OSM/Esri — z19 */
const MAX_ZOOM_DEM = 15;
const MAX_ZOOM_TEX = 19;
/** Предел стороны итоговой текстуры в пикселях (GPU + вес JPEG) */
const MAX_TEX_PX = 8192;
/**
 * Одновременных загрузок тайлов. Держим низким осознанно: политика OSM
 * разрешает не больше пары параллельных соединений, а импорт качает сотни
 * тайлов. Кэш (.tilecache) делает повторный импорт быстрым и без сети.
 */
const TILE_CONCURRENCY = 4;

export interface LatLng { lat: number; lng: number }

export interface BuildingBox {
  /** Контур в локальных метрах от центра (x — восток, z — юг) */
  p: [number, number][];
  /** Высота коробки, м */
  h: number;
  /** Высота основания над minElev, м (посадка на рельеф) */
  base: number;
}

export interface ImportResult {
  heightmap: Buffer;       // PNG, высота 16 бит: R — старший байт, G — младший
  texture: Buffer;         // JPEG схема OSM (дефолт, затемнение вне полигона)
  satellite: Buffer | null; // JPEG спутник Esri (может отсутствовать)
  widthM: number;          // размер bbox по долготе, метры
  heightM: number;         // размер bbox по широте, метры
  minElev: number;         // минимальная высота, м
  maxElev: number;         // максимальная высота, м
  /** Полигон в локальных координатах сцены (метры от центра bbox; x — восток, z — юг) */
  polygonLocal: [number, number][];
  origin: LatLng;          // центр bbox
  /** Здания из OSM (может быть пустым при недоступности Overpass) */
  buildings: BuildingBox[];
}

// ── Slippy-tile математика ──────────────────────

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/**
 * Подбор зума: самый детальный (высокий) зум, при котором область
 * укладывается в ≤ MAX_TILES тайлов. Для маленькой площадки это даёт
 * максимальную детализацию, для большой — снижает зум под лимит.
 * (Раньше использовался порог minPx, который для маленьких площадок
 * никогда не достигался и ошибочно ронял зум до z1 → пустая вырезка.)
 */
export function pickZoom(
  bbox: { west: number; east: number; north: number; south: number },
  maxZoom = MAX_ZOOM_DEM,
  maxTiles = MAX_TILES_DEM,
): number {
  // Потолок задаёт вызывающий (у рельефа и текстуры он разный) — раньше здесь
  // стоял жёсткий Math.min(maxZoom, 15), из-за чего текстура никогда не
  // поднималась выше z15, сколько бы ни просили.
  for (let z = maxZoom; z >= 1; z--) {
    const x0 = Math.floor(lngToTileX(bbox.west, z));
    const x1 = Math.floor(lngToTileX(bbox.east, z));
    const y0 = Math.floor(latToTileY(bbox.north, z));
    const y1 = Math.floor(latToTileY(bbox.south, z));
    const tiles = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (tiles <= maxTiles) return z;
  }
  return 1;
}

// ── Point-in-polygon (ray casting) ──────────────

export function pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Скачивание и склейка тайлов ─────────────────

/**
 * Сырые байты тайла: сначала из файлового кэша, иначе из сети (до 4 попыток)
 * с сохранением в кэш. `bypassCache` — принудительно скачать заново (битый кэш).
 */
async function fetchTileBytes(url: string, bypassCache = false): Promise<Buffer> {
  const cf = cachePath(url);
  if (!bypassCache && existsSync(cf)) {
    try {
      const cached = readFileSync(cf);
      if (cached.length > 0) return cached;
    } catch { /* повреждён — качаем заново */ }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // OSM и др. тайл-серверы отклоняют анонимные запросы — нужен User-Agent
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VOVPLAN/1.0 (terrain importer)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length === 0) {
          lastErr = new Error('пустое тело ответа');
        } else {
          try { writeFileSync(cf, body); } catch { /* кэш не критичен */ }
          return body;
        }
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  throw new Error(`тайл недоступен (${(lastErr as Error)?.message})`);
}

/**
 * Скачивает тайл (из кэша или сети) и декодирует в RGBA 256×256.
 * Если декод падает (битый кэш/HTML-заглушка) — сбрасывает кэш и качает заново.
 */
async function fetchTileRgba(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let bytes: Buffer;
    try {
      bytes = await fetchTileBytes(url, attempt > 0);
    } catch (err) {
      throw err; // сеть недоступна — понятная ошибка уже внутри
    }
    try {
      const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .resize(TILE, TILE, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width === TILE && info.height === TILE) return data;
      lastErr = new Error(`неверный размер тайла ${info.width}x${info.height}`);
    } catch (err) {
      lastErr = err;
    }
    // Декод не удался — вероятно битый кэш; удаляем и пробуем скачать заново
    try { rmSync(cachePath(url), { force: true }); } catch { /* ignore */ }
  }
  throw new Error(`тайл повреждён (${(lastErr as Error)?.message})`);
}

interface Mosaic {
  data: Buffer;   // RGBA
  width: number;
  height: number;
  /** пиксель (0,0) мозаики в глобальных тайловых координатах */
  originX: number;
  originY: number;
  zoom: number;
}

async function buildMosaic(
  urlOf: (z: number, x: number, y: number) => string,
  bbox: { west: number; east: number; north: number; south: number },
  z: number,
): Promise<Mosaic> {
  const x0 = Math.floor(lngToTileX(bbox.west, z));
  const x1 = Math.floor(lngToTileX(bbox.east, z));
  const y0 = Math.floor(latToTileY(bbox.north, z));
  const y1 = Math.floor(latToTileY(bbox.south, z));

  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const width = cols * TILE;
  const height = rows * TILE;
  const data = Buffer.alloc(width * height * 4);

  // Список тайлов + пул воркеров. Одним Promise.all нельзя: на высоких зумах
  // это сотни одновременных запросов, а тайл-серверы (в частности OSM) такое
  // считают злоупотреблением и блокируют IP.
  const coords: [number, number][] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) coords.push([tx, ty]);
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= coords.length) return;
      const [tx, ty] = coords[i];
      const rgba = await fetchTileRgba(urlOf(z, tx, ty));
      const offX = (tx - x0) * TILE;
      const offY = (ty - y0) * TILE;
      for (let row = 0; row < TILE; row++) {
        const src = row * TILE * 4;
        const dst = ((offY + row) * width + offX) * 4;
        rgba.copy(data, dst, src, src + TILE * 4);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, coords.length) }, worker));

  return { data, width, height, originX: x0, originY: y0, zoom: z };
}

/** Вырезка точного bbox из мозаики (пиксельные координаты через тайловую проекцию) */
function cropMosaic(m: Mosaic, bbox: { west: number; east: number; north: number; south: number }) {
  const pxW = (lngToTileX(bbox.west, m.zoom) - m.originX) * TILE;
  const pxE = (lngToTileX(bbox.east, m.zoom) - m.originX) * TILE;
  const pxN = (latToTileY(bbox.north, m.zoom) - m.originY) * TILE;
  const pxS = (latToTileY(bbox.south, m.zoom) - m.originY) * TILE;

  const x = Math.max(0, Math.round(pxW));
  const y = Math.max(0, Math.round(pxN));
  const w = Math.min(m.width - x, Math.round(pxE - pxW));
  const h = Math.min(m.height - y, Math.round(pxS - pxN));

  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * m.width + x) * 4;
    out.set(m.data.subarray(src, src + w * 4), row * w * 4);
  }
  return { data: out, width: w, height: h };
}

// ── Здания из OSM (Overpass API) ────────────────

// Публичные зеркала Overpass — перебираем при перегрузке (504/429) одного из них
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const MAX_BUILDINGS = 4000;
const FLOOR_HEIGHT_M = 3;
const DEFAULT_BUILDING_H = 9; // 3 этажа, если OSM не знает высоту

/** Высота здания из OSM-тегов: height → building:levels × 3м → дефолт */
export function buildingHeight(tags: Record<string, string> | undefined): number {
  if (!tags) return DEFAULT_BUILDING_H;
  const h = parseFloat(tags['height'] ?? tags['building:height'] ?? '');
  if (Number.isFinite(h) && h > 0 && h < 500) return h;
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0 && levels < 150) {
    return levels * FLOOR_HEIGHT_M;
  }
  return DEFAULT_BUILDING_H;
}

interface OverpassWay {
  type: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Контуры зданий bbox из Overpass. Ошибки не валят импорт — вернём []. */
async function fetchBuildings(
  bbox: { west: number; east: number; north: number; south: number },
): Promise<{ latlngs: LatLng[]; height: number }[]> {
  const query = `[out:json][timeout:25];way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out geom ${MAX_BUILDINGS};`;

  const parseElements = (elements: OverpassWay[] | undefined) => {
    const out: { latlngs: LatLng[]; height: number }[] = [];
    for (const el of elements ?? []) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
      out.push({
        latlngs: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
        height: buildingHeight(el.tags),
      });
    }
    return out;
  };

  // Кэш ответа Overpass по хэшу запроса (bbox) — повторный импорт не зависит
  // от перегрузки Overpass; здания в OSM меняются редко.
  const cf = cachePath('overpass:' + query);
  if (existsSync(cf)) {
    try {
      const cached = JSON.parse(readFileSync(cf, 'utf-8')) as { elements?: OverpassWay[] };
      return parseElements(cached.elements);
    } catch { /* повреждён — запрашиваем заново */ }
  }

  // Перебираем зеркала: перегруженное отдаёт 504/429 — идём к следующему
  for (const host of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass отклоняет анонимные запросы (406) — нужен осмысленный User-Agent
          'User-Agent': 'VOVPLAN/1.0 (terrain importer)',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OverpassWay[] };
      try { writeFileSync(cf, JSON.stringify({ elements: json.elements ?? [] })); } catch { /* кэш не критичен */ }
      return parseElements(json.elements);
    } catch (err) {
      console.warn(`[terrain] Overpass ${host.split('/')[2]} недоступен:`, (err as Error).message);
    }
  }
  // Все зеркала перегружены — площадка без зданий лучше, чем ошибка импорта
  console.warn('[terrain] здания не загружены (все зеркала Overpass недоступны)');
  return [];
}

// ── Основной импорт ─────────────────────────────

export async function importRealTerrain(polygon: LatLng[]): Promise<ImportResult> {
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  const bbox = {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };

  // Паддинг 3% — чтобы периметр не упирался в край
  const padLat = (bbox.north - bbox.south) * 0.03 || 0.0005;
  const padLng = (bbox.east - bbox.west) * 0.03 || 0.0005;
  bbox.north += padLat; bbox.south -= padLat;
  bbox.east += padLng; bbox.west -= padLng;

  const origin: LatLng = {
    lat: (bbox.north + bbox.south) / 2,
    lng: (bbox.east + bbox.west) / 2,
  };

  // Размеры в метрах (equirectangular приближение — достаточно для <50 км)
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const widthM = (bbox.east - bbox.west) * mPerDegLng;
  const heightM = (bbox.north - bbox.south) * mPerDegLat;

  // ── DEM ──
  // Максимальная детальность: на z15 terrarium даёт ~2.7м/пиксель на 55°
  // широты — перепады набережная/река становятся различимы
  const zDem = pickZoom(bbox, MAX_ZOOM_DEM, MAX_TILES_DEM);
  const demMosaic = await buildMosaic(TERRARIUM_URL, bbox, zDem);
  const dem = cropMosaic(demMosaic, bbox);
  if (dem.width < 2 || dem.height < 2) {
    throw new Error(`вырезка рельефа пуста (${dem.width}x${dem.height}px, zoom ${zDem})`);
  }

  // Декод высот terrarium
  const elev = new Float32Array(dem.width * dem.height);
  for (let i = 0; i < elev.length; i++) {
    const r = dem.data[i * 4];
    const g = dem.data[i * 4 + 1];
    const b = dem.data[i * 4 + 2];
    elev[i] = r * 256 + g + b / 256 - 32768;
  }

  // В terrarium встречаются выбросы (артефакты у воды, no-data пиксели) —
  // берём диапазон по перцентилям 0.5%..99.5% и клиппим значения к нему
  const sorted = Float32Array.from(elev).sort();
  const minElev = sorted[Math.floor(sorted.length * 0.005)];
  const maxElev = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))];
  const range = Math.max(maxElev - minElev, 1);
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < minElev) elev[i] = minElev;
    else if (elev[i] > maxElev) elev[i] = maxElev;
  }

  // Heightmap PNG, 16-бит кодирование: R — старший байт, G — младший.
  // 8-бит квантование давало «терраски» ~0.4м; 16 бит — шаг ~1.4мм.
  const hmRaw = Buffer.alloc(dem.width * dem.height * 4);
  for (let i = 0; i < elev.length; i++) {
    const v16 = Math.round(((elev[i] - minElev) / range) * 65535);
    hmRaw[i * 4] = v16 >> 8;
    hmRaw[i * 4 + 1] = v16 & 0xff;
    hmRaw[i * 4 + 2] = 0;
    hmRaw[i * 4 + 3] = 255;
  }
  const heightmap = await sharp(hmRaw, { raw: { width: dem.width, height: dem.height, channels: 4 } })
    .png()
    .toBuffer();

  // ── Две текстуры: схема (OSM) по умолчанию + спутник (Esri) ──
  // Максимальная детальность карты: тянем до z19 (предел OSM/Esri) в рамках
  // тайлового бюджета текстуры. Рельеф ограничен z15 (выше terrarium данных
  // не добавляет), поэтому текстура почти всегда детальнее рельефа.
  const zFinal = Math.max(pickZoom(bbox, MAX_ZOOM_TEX, MAX_TILES_TEX), zDem);

  // Маска полигона + JPEG. Затемняем всё вне периметра («вырез» участка).
  const maskAndEncode = async (urlOf: (z: number, x: number, y: number) => string): Promise<Buffer> => {
    const mosaic = await buildMosaic(urlOf, bbox, zFinal);
    const tex = cropMosaic(mosaic, bbox);
    const polyPx: [number, number][] = polygon.map((p) => [
      ((p.lng - bbox.west) / (bbox.east - bbox.west)) * tex.width,
      ((bbox.north - p.lat) / (bbox.north - bbox.south)) * tex.height,
    ]);
    for (let y = 0; y < tex.height; y++) {
      for (let x = 0; x < tex.width; x++) {
        if (!pointInPolygon(x + 0.5, y + 0.5, polyPx)) {
          const i = (y * tex.width + x) * 4;
          tex.data[i] = Math.round(tex.data[i] * 0.35);
          tex.data[i + 1] = Math.round(tex.data[i + 1] * 0.35);
          tex.data[i + 2] = Math.round(tex.data[i + 2] * 0.35);
        }
      }
    }
    let img = sharp(tex.data, { raw: { width: tex.width, height: tex.height, channels: 4 } });
    // На высоких зумах вырезка может превысить лимит текстуры GPU — ужимаем
    // только в этом случае, обычная детализация не страдает.
    if (Math.max(tex.width, tex.height) > MAX_TEX_PX) {
      img = img.resize(MAX_TEX_PX, MAX_TEX_PX, { fit: 'inside' });
    }
    // mozjpeg + q95: заметно чище на мелких деталях (подписи, разметка)
    return img.jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  };

  // Схема — дефолт (чёткая, читаемая); спутник — по желанию через переключатель.
  // Если Esri недоступен, спутник не срабатывает — схема всё равно есть.
  const texture = await maskAndEncode(OSM_URL);
  let satellite: Buffer | null = null;
  try {
    satellite = await maskAndEncode(ESRI_URL);
  } catch (err) {
    console.warn('[terrain] спутниковая текстура недоступна:', (err as Error).message);
  }

  // Полигон в локальных метрах от центра (x — восток, z — юг: соответствует сцене three.js)
  const toLocal = (p: LatLng): [number, number] => [
    (p.lng - origin.lng) * mPerDegLng,
    (origin.lat - p.lat) * mPerDegLat,
  ];
  const polygonLocal: [number, number][] = polygon.map(toLocal);

  // ── Здания (OSM) ──
  // Сэмпл высоты рельефа в точке (локальные метры) — для посадки коробок
  const elevAtLocal = (x: number, z: number): number => {
    const px = Math.round(((x + widthM / 2) / widthM) * (dem.width - 1));
    const py = Math.round(((z + heightM / 2) / heightM) * (dem.height - 1));
    const cx = Math.min(Math.max(px, 0), dem.width - 1);
    const cy = Math.min(Math.max(py, 0), dem.height - 1);
    return elev[cy * dem.width + cx];
  };

  const rawBuildings = await fetchBuildings(bbox);
  const buildings: BuildingBox[] = rawBuildings.map((b) => {
    const p = b.latlngs.map(toLocal);
    // Основание — минимум рельефа по вершинам контура (чтобы не висело на склоне)
    let base = Infinity;
    for (const [x, z] of p) {
      const e = elevAtLocal(x, z);
      if (e < base) base = e;
    }
    return {
      p: p.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as [number, number]),
      h: b.height,
      base: Math.round((base - minElev) * 10) / 10,
    };
  });

  return { heightmap, texture, satellite, widthM, heightM, minElev, maxElev, polygonLocal, origin, buildings };
}
