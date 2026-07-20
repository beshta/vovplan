import { describe, it, expect } from 'vitest';
import { lngToTileX, latToTileY, pickZoom, pointInPolygon, buildingHeight } from './importer.js';

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

  it('pickZoom: маленькая площадка → максимальный зум, большая → ниже', () => {
    const bboxSmall = { west: 37.53, east: 37.57, north: 55.715, south: 55.695 };
    const z = pickZoom(bboxSmall);
    expect(z).toBe(15); // маленькая площадка укладывается в лимит тайлов на макс. зуме

    // Большая область → зум меньше (иначе тайлов больше лимита)
    const bboxBig = { west: 37.0, east: 38.0, north: 56.0, south: 55.0 };
    expect(pickZoom(bboxBig)).toBeLessThan(z);
  });

  it('pickZoom: крошечная область всё равно z15, не падает до z1 (регресс)', () => {
    // Раньше порог minPx ронял зум до z1 → пустая вырезка → «Input Buffer is empty»
    const tiny = { west: 37.150, east: 37.170, north: 56.735, south: 56.715 };
    expect(pickZoom(tiny)).toBe(15);
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

describe('terrain importer: высота зданий из OSM-тегов', () => {
  it('явный height приоритетнее этажей', () => {
    expect(buildingHeight({ height: '25', 'building:levels': '3' })).toBe(25);
  });

  it('этажи × 3м', () => {
    expect(buildingHeight({ 'building:levels': '9' })).toBe(27);
  });

  it('дефолт без тегов — 9м (3 этажа)', () => {
    expect(buildingHeight(undefined)).toBe(9);
    expect(buildingHeight({})).toBe(9);
  });

  it('мусорные значения → дефолт', () => {
    expect(buildingHeight({ height: 'высокое' })).toBe(9);
    expect(buildingHeight({ height: '-5' })).toBe(9);
    expect(buildingHeight({ 'building:levels': '9999' })).toBe(9);
  });
});
