import { TERRAIN_ADJUST_OFF, type TerrainAdjust } from '../../../shared/api';

/**
 * Правка сетки высот: сглаживание, выравнивание, вертикальный масштаб.
 *
 * Зачем это нужно: открытые данные о высотах идут сеткой 30 м. На участке в
 * двести метров это тринадцать точек поперёк, и всё, что мельче, не измерено,
 * а получено растягиванием. Замер на реальной площадке показал разброс между
 * источниками до 12 м — больше, чем сам рельеф. Перейти на источник точнее
 * нельзя: данных лучше по стране в открытом доступе нет, а те, что точнее по
 * паспорту, на таком масштабе шумят сильнее.
 *
 * Поэтому правку задаёт человек, который на площадке бывал.
 *
 * Значения нормированы (0…1) — как и приходят из снимка высот. Считается один
 * раз в отдельный массив: по нему строится и меш, и ходьба от первого лица, и
 * посадка объектов на землю — расхождение между ними было бы заметно сразу.
 */
export function buildHeightGrid(
  raw: (x: number, y: number) => number,
  width: number,
  height: number,
  /** Размеры площадки в метрах — по ним радиус сглаживания переводится в пиксели */
  sizeX: number,
  sizeZ: number,
  adjust: TerrainAdjust = TERRAIN_ADJUST_OFF,
): Float32Array {
  let grid: Float32Array = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid[y * width + x] = raw(x, y);
  }

  if (adjust.smooth > 0) grid = smooth(grid, width, height, sizeX, sizeZ, adjust.smooth);
  if (adjust.level > 0) grid = level(grid, adjust.level);
  if (adjust.scale !== 1) grid = rescale(grid, adjust.scale);

  return grid;
}

/**
 * Сглаживание скользящим средним.
 *
 * Радиус задан в метрах, а не в пикселях: снимки высот у разных участков
 * разного разрешения, и одна и та же цифра в пикселях значила бы разное.
 */
function smooth(
  grid: Float32Array,
  width: number,
  height: number,
  sizeX: number,
  sizeZ: number,
  radiusM: number,
): Float32Array {
  const rx = Math.round(radiusM / (sizeX / Math.max(width - 1, 1)));
  const ry = Math.round(radiusM / (sizeZ / Math.max(height - 1, 1)));
  if (rx <= 0 && ry <= 0) return grid;

  // По осям порознь: результат тот же, что у обычного размытия, но работы
  // кратно меньше — на сетке 640² это заметно
  const pass = (src: Float32Array, r: number, horizontal: boolean): Float32Array => {
    if (r <= 0) return src;
    const dst = new Float32Array(src.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const j = i + k;
          if (j < 0 || j >= inner) continue;
          sum += horizontal ? src[o * width + j] : src[j * width + o];
          n++;
        }
        if (horizontal) dst[o * width + i] = sum / n;
        else dst[i * width + o] = sum / n;
      }
    }
    return dst;
  };

  return pass(pass(grid, rx, true), ry, false);
}

/**
 * Подтягивание к опорной отметке: 0 — как есть, 1 — идеально ровная площадка.
 *
 * Опора — медиана, а не среднее: единственный обрыв по краю участка утянул бы
 * среднее за собой и поднял бы всю площадку.
 */
function level(grid: Float32Array, strength: number): Float32Array {
  const sorted = Float32Array.from(grid).sort();
  const median = sorted[sorted.length >> 1];
  const k = Math.min(strength, 1);
  const out = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = grid[i] + (median - grid[i]) * k;
  return out;
}

/**
 * Вертикальный масштаб.
 *
 * Тянем к средней отметке, а не к нулю: иначе площадка при уплощении
 * проваливалась бы под объекты, уже расставленные на ней.
 */
function rescale(grid: Float32Array, scale: number): Float32Array {
  let sum = 0;
  for (let i = 0; i < grid.length; i++) sum += grid[i];
  const mean = sum / grid.length;
  const out = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = mean + (grid[i] - mean) * scale;
  return out;
}
