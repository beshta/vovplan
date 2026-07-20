import sharp from 'sharp';

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

const TILE = 256;
/** Максимум тайлов на запрос (защита от гигантских областей) */
const MAX_TILES = 48;

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
  texture: Buffer;         // JPEG (затемнение вне полигона)
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
  maxZoom = 15,
): number {
  for (let z = Math.min(maxZoom, 15); z >= 1; z--) {
    const x0 = Math.floor(lngToTileX(bbox.west, z));
    const x1 = Math.floor(lngToTileX(bbox.east, z));
    const y0 = Math.floor(latToTileY(bbox.north, z));
    const y1 = Math.floor(latToTileY(bbox.south, z));
    const tiles = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (tiles <= MAX_TILES) return z;
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
 * Скачивает тайл (PNG или JPEG) и декодирует в RGBA 256×256. До 4 попыток.
 * И сетевые ошибки, и битые/пустые тела ретраятся — наружу летит только
 * понятная ошибка после исчерпания попыток (не сырой «Input Buffer is empty»).
 */
async function fetchTileRgba(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length === 0) {
          lastErr = new Error('пустое тело ответа');
        } else {
          // Декодируем здесь же: битый PNG (например, HTML-заглушка ошибки)
          // тоже должен привести к ретраю, а не к падению всего импорта
          const { data, info } = await sharp(body)
            .ensureAlpha()
            .resize(TILE, TILE, { fit: 'fill' })
            .raw()
            .toBuffer({ resolveWithObject: true });
          if (info.width === TILE && info.height === TILE) {
            return data;
          }
          lastErr = new Error(`неверный размер тайла ${info.width}x${info.height}`);
        }
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  throw new Error(`тайл недоступен (${(lastErr as Error)?.message})`);
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

  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        fetchTileRgba(urlOf(z, tx, ty)).then((rgba) => {
          const offX = (tx - x0) * TILE;
          const offY = (ty - y0) * TILE;
          for (let row = 0; row < TILE; row++) {
            const src = row * TILE * 4;
            const dst = ((offY + row) * width + offX) * 4;
            rgba.copy(data, dst, src, src + TILE * 4);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);

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
      const out: { latlngs: LatLng[]; height: number }[] = [];
      for (const el of json.elements ?? []) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
        out.push({
          latlngs: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
          height: buildingHeight(el.tags),
        });
      }
      return out;
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
  const zDem = pickZoom(bbox, 15);
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

  // ── Спутниковая текстура (зум повыше для чёткости) ──
  // Текстура чуть детальнее рельефа (спутник резче), но в пределах лимита тайлов
  const zTex = pickZoom(bbox, zDem + 2);
  const texMosaic = await buildMosaic(ESRI_URL, bbox, Math.max(zTex, zDem));
  const tex = cropMosaic(texMosaic, bbox);

  // Маска полигона: затемняем всё, что вне периметра («вырез» участка)
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
  const texture = await sharp(tex.data, { raw: { width: tex.width, height: tex.height, channels: 4 } })
    .jpeg({ quality: 85 })
    .toBuffer();

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

  return { heightmap, texture, widthM, heightM, minElev, maxElev, polygonLocal, origin, buildings };
}
