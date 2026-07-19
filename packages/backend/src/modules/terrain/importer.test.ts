import { describe, it, expect } from 'vitest';
import { lngToTileX, latToTileY, pickZoom, pointInPolygon } from './importer.js';

describe('terrain importer: тайловая математика', () => {
  it('lng/lat → тайловые координаты (Москва, z=10)', () => {
    // Проверка против известных значений slippy-схемы
    expect(Math.floor(lngToTileX(37.6173, 10))).toBe(619);
    expect(Math.floor(latToTileY(55.7558, 10))).toBe(320);
  });

  it('крайние значения: lng -180 → x=0, lng +180 → x=2^z', () => {
    expect(lngToTileX(-180, 5)).toBe(0);
    expect(lngToTileX(180, 5)).toBe(32);
  });

  it('pickZoom даёт достаточное разрешение и не превышает лимит тайлов', () => {
    const bboxSmall = { west: 37.53, east: 37.57, north: 55.715, south: 55.695 };
    const z = pickZoom(bboxSmall, 384);
    expect(z).toBeGreaterThanOrEqual(10);
    expect(z).toBeLessThanOrEqual(15);

    // Большая область → зум меньше
    const bboxBig = { west: 37.0, east: 38.0, north: 56.0, south: 55.0 };
    expect(pickZoom(bboxBig, 384)).toBeLessThan(z);
  });
});

describe('terrain importer: point-in-polygon', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('точка внутри квадрата', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('точка снаружи', () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
  });

  it('невыпуклый полигон (L-образный)', () => {
    const lShape: [number, number][] = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];
    expect(pointInPolygon(2, 8, lShape)).toBe(true);   // в «ноге» L
    expect(pointInPolygon(8, 8, lShape)).toBe(false);  // в вырезе
  });
});
