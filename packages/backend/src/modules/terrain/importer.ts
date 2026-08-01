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

/** Тип листвы: хвойный / лиственный / смешанный — форма схематичного дерева */
export type LeafKind = 'needle' | 'broad' | 'mixed';

/** Массив леса: контур в локальных метрах + тип листвы */
export interface ForestArea {
  p: [number, number][];
  leaf: LeafKind;
}

/** Водоём: контур в локальных метрах + уровень воды над minElev, м */
export interface WaterArea {
  p: [number, number][];
  /** Уровень поверхности (для стоячей воды — единый на весь контур) */
  level: number;
  /**
   * Отметка на каждой вершине контура. Есть только у сегментов рек: река
   * течёт под уклон, и одинаковый level на соседних сегментах давал видимые
   * ступеньки на стыках. С отметками по вершинам полотно непрерывное.
   */
  levels?: number[];
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
  /** Массивы леса из OSM — фронт расставляет по ним схематичные деревья */
  forests: ForestArea[];
  /** Водоёмы из OSM (реки, озёра, пруды, болота) с уровнем воды */
  water: WaterArea[];
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

/**
 * Обрезка полигона прямоугольником (Сазерленд — Ходжман). Нужна воде:
 * ринг Москвы-реки из OSM в разы больше площадки, и без обрезки полотно
 * висело бы далеко за краем рельефа.
 */
export function clipToRect(
  poly: [number, number][],
  minX: number, maxX: number, minZ: number, maxZ: number,
): [number, number][] {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= minX, (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= maxX, (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= minZ, (a, b) => [a[0] + ((b[0] - a[0]) * (minZ - a[1])) / (b[1] - a[1]), minZ]],
    [(p) => p[1] <= maxZ, (a, b) => [a[0] + ((b[0] - a[0]) * (maxZ - a[1])) / (b[1] - a[1]), maxZ]],
  ];
  let out = poly;
  for (const [inside, intersect] of edges) {
    if (out.length === 0) return [];
    const next: [number, number][] = [];
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      const prev = out[(i + out.length - 1) % out.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) next.push(intersect(prev, cur));
        next.push(cur);
      } else if (prevIn) {
        next.push(intersect(prev, cur));
      }
    }
    out = next;
  }
  return out;
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
/** Максимум природных контуров (лес + вода) на импорт */
const MAX_NATURE = 1200;
/**
 * На сколько метров русло опускается ниже уровня воды. DEM слишком грубый,
 * чтобы показать русло сам, — вырезаем его явно, иначе плоскость воды
 * утапливается в рельеф и не видна.
 */
const WATER_CARVE_DEPTH = 2.5;
/**
 * Целевой размер пикселя рельефа, м. Тайлы terrarium дают ~2.7 м/пиксель на
 * 55° широты — для реки шириной 5 м это меньше двух пикселей, русло выходит
 * рваным. Перед вырезанием сетку интерполируем до этого шага.
 */
const TARGET_DEM_PX_M = 1.0;
/** Потолок стороны сетки рельефа (память: сторона² × 4 байта) */
const MAX_DEM_PX = 2048;
/** Ширина водотока по типу, если нет тега width (м) */
const WATERWAY_WIDTH: Record<string, number> = {
  river: 12, canal: 8, stream: 3, ditch: 2, drain: 2,
};
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
  /** У relation (мультиполигон) геометрия лежит в членах */
  members?: { type: string; role?: string; geometry?: { lat: number; lon: number }[] }[];
}

/**
 * Контуры элемента: у way — своя геометрия, у relation — внешние кольца
 * членов. Крупные водоёмы и лесные массивы в OSM размечены именно
 * отношениями, и без этого Москва-река не находилась вовсе.
 */
function ringsOf(el: OverpassWay): LatLng[][] {
  const toLL = (g: { lat: number; lon: number }[]) => g.map((p) => ({ lat: p.lat, lng: p.lon }));
  if (el.type === 'relation') {
    return (el.members ?? [])
      .filter((m) => m.type === 'way' && m.role !== 'inner' && (m.geometry?.length ?? 0) >= 3)
      .map((m) => toLL(m.geometry!));
  }
  return el.geometry && el.geometry.length >= 2 ? [toLL(el.geometry)] : [];
}

/**
 * Запрос к Overpass с кэшем и перебором зеркал. Ошибки не валят импорт —
 * вернём null, вызывающий решает, что делать без данных.
 */
async function overpassQuery(query: string, what: string): Promise<OverpassWay[] | null> {
  // Кэш ответа по хэшу запроса — повторный импорт не зависит от перегрузки
  // Overpass; здания и природа в OSM меняются редко.
  const cf = cachePath('overpass:' + query);
  if (existsSync(cf)) {
    try {
      return (JSON.parse(readFileSync(cf, 'utf-8')) as { elements?: OverpassWay[] }).elements ?? [];
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
      return json.elements ?? [];
    } catch (err) {
      console.warn(`[terrain] Overpass ${host.split('/')[2]} недоступен:`, (err as Error).message);
    }
  }
  console.warn(`[terrain] ${what} не загружены (все зеркала Overpass недоступны)`);
  return null;
}

/**
 * Фильтр Overpass по самому периметру, а не по bbox. В плотной застройке
 * (центр города) запрос по bbox возвращал на порядок больше объектов и
 * упирался в таймаут — здания не приходили вовсе.
 */
function polyFilter(polygon: LatLng[]): string {
  const coords = polygon.map((p) => `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`).join(' ');
  return `(poly:"${coords}")`;
}

/** Контуры зданий внутри периметра. Ошибки не валят импорт — вернём []. */
async function fetchBuildings(polygon: LatLng[]): Promise<{ latlngs: LatLng[]; height: number }[]> {
  const f = polyFilter(polygon);
  const query = `[out:json][timeout:90];way["building"]${f};out geom ${MAX_BUILDINGS};`;
  const elements = await overpassQuery(query, 'здания');
  const out: { latlngs: LatLng[]; height: number }[] = [];
  for (const el of elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
    out.push({
      latlngs: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
      height: buildingHeight(el.tags),
    });
  }
  return out;
}

/** Тип листвы леса по тегам OSM — определяет форму схематичного дерева */
export function leafKind(tags: Record<string, string> | undefined): LeafKind {
  const t = tags?.leaf_type ?? '';
  if (t === 'needleleaved') return 'needle';
  if (t === 'broadleaved') return 'broad';
  if (t === 'mixed') return 'mixed';
  // Явного тега нет — пробуем по типу растительности
  const wood = tags?.wood ?? '';
  if (wood === 'coniferous') return 'needle';
  if (wood === 'deciduous') return 'broad';
  return 'mixed';
}

/**
 * Природные объекты bbox: массивы леса и водоёмы.
 * Лес — landuse=forest / natural=wood, вода — natural=water,
 * waterway=riverbank, landuse=reservoir (реки, озёра, пруды, болота, море).
 */
async function fetchNature(polygon: LatLng[]): Promise<{
  forests: { latlngs: LatLng[]; leaf: LeafKind }[];
  water: { latlngs: LatLng[] }[];
  streams: { latlngs: LatLng[]; width: number }[];
}> {
  const b = polyFilter(polygon);
  // nwr = way + relation: крупные реки, озёра и лесные массивы размечены
  // мультиполигонами-отношениями, только way их не находит
  const query =
    `[out:json][timeout:90];(` +
    `nwr["landuse"="forest"]${b};nwr["natural"="wood"]${b};` +
    `nwr["natural"="water"]${b};nwr["natural"="wetland"]${b};` +
    `nwr["waterway"="riverbank"]${b};nwr["landuse"="reservoir"]${b};` +
    // Узкие реки и ручьи в OSM размечены линией, а не полигоном — без них
    // река шириной 5–10 м вообще не считалась водоёмом
    `way["waterway"~"^(river|stream|canal|ditch|drain)$"]${b};` +
    `);out geom ${MAX_NATURE};`;

  const elements = await overpassQuery(query, 'природные объекты');
  const forests: { latlngs: LatLng[]; leaf: LeafKind }[] = [];
  const water: { latlngs: LatLng[] }[] = [];
  const streams: { latlngs: LatLng[]; width: number }[] = [];

  for (const el of elements ?? []) {
    const tags = el.tags ?? {};

    // Линейный водоток (только way): осевая линия реки/ручья
    const wayType = tags.waterway ?? '';
    if (el.type === 'way' && WATERWAY_WIDTH[wayType] !== undefined) {
      const latlngs = (el.geometry ?? []).map((g) => ({ lat: g.lat, lng: g.lon }));
      if (latlngs.length < 2) continue;
      const tagged = parseFloat(tags.width ?? tags.est_width ?? '');
      const width = Number.isFinite(tagged) && tagged > 0 ? tagged : WATERWAY_WIDTH[wayType];
      streams.push({ latlngs, width });
      continue;
    }

    const isWater =
      tags.natural === 'water' || tags.natural === 'wetland' ||
      tags.waterway === 'riverbank' || tags.landuse === 'reservoir';
    const isForest = tags.landuse === 'forest' || tags.natural === 'wood';
    if (!isWater && !isForest) continue;

    for (const latlngs of ringsOf(el)) {
      if (latlngs.length < 3) continue;
      if (isWater) water.push({ latlngs });
      else forests.push({ latlngs, leaf: leafKind(tags) });
    }
  }
  return { forests, water, streams };
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
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < minElev) elev[i] = minElev;
    else if (elev[i] > maxElev) elev[i] = maxElev;
  }

  const round1 = (v: number) => Math.round(v * 10) / 10;

  // ── Повышение разрешения сетки под вырезание русел ──
  // Тайлы DEM грубее, чем нужно узким рекам. Интерполируем сетку до
  // TARGET_DEM_PX_M: сам рельеф детальнее не станет (данных больше нет),
  // но вырезанное русло получается ровным, а не рваным на два пикселя.
  const srcW = dem.width;
  const srcH = dem.height;
  const scale = Math.min(
    Math.max(1, Math.ceil(Math.max(widthM / srcW, heightM / srcH) / TARGET_DEM_PX_M)),
    Math.max(1, Math.floor(MAX_DEM_PX / Math.max(srcW, srcH))),
  );
  const gridW = srcW * scale;
  const gridH = srcH * scale;

  let grid: Float32Array;
  if (scale === 1) {
    grid = elev;
  } else {
    grid = new Float32Array(gridW * gridH);
    for (let y = 0; y < gridH; y++) {
      const v = (y / (gridH - 1)) * (srcH - 1);
      const y0 = Math.floor(v);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const fy = v - y0;
      for (let x = 0; x < gridW; x++) {
        const u = (x / (gridW - 1)) * (srcW - 1);
        const x0 = Math.floor(u);
        const x1 = Math.min(x0 + 1, srcW - 1);
        const fx = u - x0;
        const top = elev[y0 * srcW + x0] * (1 - fx) + elev[y0 * srcW + x1] * fx;
        const bot = elev[y1 * srcW + x0] * (1 - fx) + elev[y1 * srcW + x1] * fx;
        grid[y * gridW + x] = top * (1 - fy) + bot * fy;
      }
    }
  }

  // ── Природа (лес + вода) ──
  // Грузим до кодирования heightmap: русло вырезается прямо в рельефе.
  // Иначе вода не видна: terrarium на z15 даёт ~30 м на пиксель, и река
  // шириной в десятки метров вообще не образует впадину — плоскость воды
  // оказывалась на уровне земли или под ней.
  const rawNature = await fetchNature(polygon);

  /** lat/lng → пиксель сетки рельефа */
  const gridPx = (ll: LatLng): [number, number] => [
    ((ll.lng - bbox.west) / (bbox.east - bbox.west)) * (gridW - 1),
    ((bbox.north - ll.lat) / (bbox.north - bbox.south)) * (gridH - 1),
  ];
  const sampleGrid = (x: number, y: number): number => {
    const cx = Math.min(gridW - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(gridH - 1, Math.max(0, Math.round(y)));
    return grid[cy * gridW + cx];
  };
  const bboxOf = (poly: [number, number][]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  };
  /** Уровень воды: нижний квартиль высот по контуру — устойчив и к выбросам
   *  DEM, и к берегам (среднее задирало бы уровень над руслом) */
  const waterLevelOf = (poly: [number, number][]): number => {
    const s = poly.map(([x, y]) => sampleGrid(x, y)).sort((a, b2) => a - b2);
    return s[Math.floor(s.length * 0.25)];
  };

  type WaterPatch = {
    latlngs: LatLng[];
    poly: [number, number][];
    level: number;
    /** Отметки по вершинам — только у сегментов рек (уклон вдоль русла) */
    vertexLevels?: number[];
  };

  // Водоёмы-полигоны (озёра, пруды, широкие реки, болота)
  const waterPolys: WaterPatch[] = rawNature.water
    .map((w) => {
      const poly = w.latlngs.map(gridPx);
      if (poly.length < 3) return null;
      return { latlngs: w.latlngs, poly, level: waterLevelOf(poly) };
    })
    .filter((w): w is WaterPatch => w !== null);
  const waterPatches: WaterPatch[] = [...waterPolys];

  const toLL = (px: number, py: number): LatLng => ({
    lng: bbox.west + (px / (gridW - 1)) * (bbox.east - bbox.west),
    lat: bbox.north - (py / (gridH - 1)) * (bbox.north - bbox.south),
  });

  // Водотоки-линии → полотно по руслу.
  const mPerPxLng = widthM / Math.max(gridW - 1, 1);
  const mPerPxLat = heightM / Math.max(gridH - 1, 1);

  for (const s of rawNature.streams) {
    const pts = s.latlngs.map(gridPx);
    if (pts.length < 2) continue;

    // У широкой реки в OSM есть и полигон берегов, и осевая линия. Раньше
    // линия буферизовалась поверх полигона фиксированной шириной — оттого все
    // реки выглядели одинаково узкими. Осевую внутри полигона пропускаем:
    // настоящую ширину задаёт сам полигон.
    const covered = pts.filter(([x, y]) =>
      waterPolys.some((w) => pointInPolygon(x, y, w.poly)),
    ).length;
    if (covered > pts.length * 0.6) continue;

    // Сырые отметки по вершинам, затем сглаживание: DEM шумит, и от этого
    // соседние сегменты прыгали по высоте — русло шло «лесенкой».
    const raw = pts.map(([x, y]) => sampleGrid(x, y));
    const smooth = raw.map((_, i) => {
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) {
        sum += raw[k]; n++;
      }
      return sum / n;
    });
    // Река не течёт вверх: делаем профиль монотонным по направлению стока
    const downhill = smooth[smooth.length - 1] <= smooth[0];
    if (downhill) {
      for (let i = 1; i < smooth.length; i++) smooth[i] = Math.min(smooth[i], smooth[i - 1]);
    } else {
      for (let i = smooth.length - 2; i >= 0; i--) smooth[i] = Math.min(smooth[i], smooth[i + 1]);
    }

    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      // Нормаль к сегменту в пикселях с учётом разного масштаба по осям
      const dxM = (x2 - x1) * mPerPxLng;
      const dyM = (y2 - y1) * mPerPxLat;
      const lenM = Math.hypot(dxM, dyM);
      if (lenM < 0.5) continue;
      const halfW = Math.max(s.width, 2) / 2;
      const nxPx = (-dyM / lenM) * halfW / mPerPxLng;
      const nyPx = (dxM / lenM) * halfW / mPerPxLat;
      const poly: [number, number][] = [
        [x1 + nxPx, y1 + nyPx], [x2 + nxPx, y2 + nyPx],
        [x2 - nxPx, y2 - nyPx], [x1 - nxPx, y1 - nyPx],
      ];
      // Порядок отметок повторяет порядок вершин квада: смежные сегменты
      // делят вершину и её высоту, поэтому полотно стыкуется без ступеньки.
      const a = smooth[i];
      const b2 = smooth[i + 1];
      waterPatches.push({
        latlngs: poly.map(([px, py]) => toLL(px, py)),
        poly,
        level: Math.min(a, b2),
        vertexLevels: [a, b2, b2, a],
      });
    }
  }

  // Русло опускаем ниже уровня воды — плоскость воды гарантированно видна.
  // Если получается ниже minElev, сдвигаем minElev: все выходные отметки
  // (вода, основания зданий, рельеф) считаются относительно него.
  let minElevAdj = minElev;
  for (const w of waterPatches) {
    minElevAdj = Math.min(minElevAdj, w.level - WATER_CARVE_DEPTH);
  }
  const rangeAdj = Math.max(maxElev - minElevAdj, 1);

  // Вырезаем русло: внутри контура рельеф = уровень воды минус глубина
  for (const w of waterPatches) {
    const { minX, maxX, minY, maxY } = bboxOf(w.poly);
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(gridW - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(gridH - 1, Math.ceil(maxY));
    const bed = w.level - WATER_CARVE_DEPTH;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (pointInPolygon(x + 0.5, y + 0.5, w.poly)) grid[y * gridW + x] = bed;
      }
    }
  }

  // Heightmap PNG, 16-бит кодирование: R — старший байт, G — младший.
  // 8-бит квантование давало «терраски» ~0.4м; 16 бит — шаг ~1.4мм.
  const hmRaw = Buffer.alloc(gridW * gridH * 4);
  for (let i = 0; i < grid.length; i++) {
    const v16 = Math.round(((grid[i] - minElevAdj) / rangeAdj) * 65535);
    hmRaw[i * 4] = v16 >> 8;
    hmRaw[i * 4 + 1] = v16 & 0xff;
    hmRaw[i * 4 + 2] = 0;
    hmRaw[i * 4 + 3] = 255;
  }
  const heightmap = await sharp(hmRaw, { raw: { width: gridW, height: gridH, channels: 4 } })
    .png()
    .toBuffer();

  // ── Две текстуры: схема (OSM) по умолчанию + спутник (Esri) ──
  // Максимальная детальность карты: тянем до z19 (предел OSM/Esri) в рамках
  // тайлового бюджета текстуры. Рельеф ограничен z15 (выше terrarium данных
  // не добавляет), поэтому текстура почти всегда детальнее рельефа.
  const zFinal = Math.max(pickZoom(bbox, MAX_ZOOM_TEX, MAX_TILES_TEX), zDem);

  // Маска полигона + JPEG. Внутри периметра карта не осветляется — только
  // затемняется всё снаружи, чтобы участок читался за счёт контраста, а не
  // подсветки (иначе схема выглядит засвеченной).
  const maskAndEncode = async (
    urlOf: (z: number, x: number, y: number) => string,
    boostContrast = false,
  ): Promise<Buffer> => {
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
          tex.data[i] = Math.round(tex.data[i] * 0.3);
          tex.data[i + 1] = Math.round(tex.data[i + 1] * 0.3);
          tex.data[i + 2] = Math.round(tex.data[i + 2] * 0.3);
        }
      }
    }
    let img = sharp(tex.data, { raw: { width: tex.width, height: tex.height, channels: 4 } });
    if (boostContrast) {
      // Тайлы OSM намеренно пастельные — под освещением сцены они сливаются.
      // Тянем контраст вокруг средней точки и добавляем насыщенности, чтобы
      // дороги, вода и застройка различались. Спутнику это не нужно.
      img = img.linear(1.35, -0.35 * 128).modulate({ saturation: 1.5 });
    }
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
  const texture = await maskAndEncode(OSM_URL, true);
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
    // По итоговой сетке (с вырезанными руслами) — это та поверхность,
    // которая реально рендерится, на неё и садятся здания
    const px = Math.round(((x + widthM / 2) / widthM) * (gridW - 1));
    const py = Math.round(((z + heightM / 2) / heightM) * (gridH - 1));
    const cx = Math.min(Math.max(px, 0), gridW - 1);
    const cy = Math.min(Math.max(py, 0), gridH - 1);
    return grid[cy * gridW + cx];
  };

  /** Центр контура внутри рабочего периметра? Всё вне него не грузим в сцену. */
  const insidePerimeter = (p: [number, number][]): boolean => {
    let cx = 0, cz = 0;
    for (const [x, z] of p) { cx += x; cz += z; }
    return pointInPolygon(cx / p.length, cz / p.length, polygonLocal);
  };

  const rawBuildings = await fetchBuildings(polygon);
  const buildings: BuildingBox[] = rawBuildings
    .map((b) => {
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
        base: Math.round((base - minElevAdj) * 10) / 10,
      };
    })
    // bbox шире периметра (плюс паддинг), поэтому Overpass отдаёт застройку и
    // за границей участка — она только ест ресурсы и мешает читать сцену
    .filter((b) => insidePerimeter(b.p));

  // ── Природа в локальных координатах сцены ──
  // Уровни воды уже посчитаны выше (по исходному DEM, до вырезания русла) —
  // здесь только перевод контуров в метры относительно центра.
  const toLocalRounded = (ll: LatLng): [number, number] => {
    const [x, z] = toLocal(ll);
    return [round1(x), round1(z)];
  };

  const forests: ForestArea[] = rawNature.forests
    .map((f) => ({ p: f.latlngs.map(toLocalRounded), leaf: f.leaf }))
    // Массив, пересекающий границу, оставляем целиком — деревья отсекает по
    // периметру уже фронт, точно по контуру. Отбрасываем только те, что
    // целиком снаружи: рисовать по ним нечего.
    .filter((f) => f.p.length >= 3 && (insidePerimeter(f.p) || f.p.some(([x, z]) => pointInPolygon(x, z, polygonLocal))));

  // Полигоны воды из OSM бывают в разы больше площадки (ринг реки тянется на
  // километры) — обрезаем по краю рельефа, иначе полотно висит в пустоте.
  // Сегменты рек уже внутри и режутся по вершинам, поэтому их не трогаем:
  // обрезка сломала бы соответствие вершин их отметкам.
  const halfW = widthM / 2;
  const halfH = heightM / 2;
  const water: WaterArea[] = waterPatches
    .map((w) => {
      const p = w.latlngs.map(toLocalRounded);
      const level = round1(w.level - minElevAdj);
      if (w.vertexLevels) {
        return { p, level, levels: w.vertexLevels.map((v) => round1(v - minElevAdj)) };
      }
      return { p: clipToRect(p, -halfW, halfW, -halfH, halfH).map(([x, z]) => [round1(x), round1(z)] as [number, number]), level };
    })
    .filter((w) => w.p.length >= 3);

  return {
    heightmap, texture, satellite, widthM, heightM,
    minElev: minElevAdj, maxElev,
    polygonLocal, origin, buildings, forests, water,
  };
}
