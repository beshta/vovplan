import { describe, it, expect } from 'vitest';
import { lngToTileX, latToTileY, pickZoom, pointInPolygon, buildingHeight, clipToRect, leafKind, stitchRings, clipSegmentToRect } from './importer.js';

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

describe('terrain importer: обрезка воды по краю площадки', () => {
  const rect = [-100, 100, -100, 100] as const;

  it('полигон целиком внутри — не меняется', () => {
    const p: [number, number][] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    expect(clipToRect(p, ...rect)).toEqual(p);
  });

  it('полигон больше площадки — обрезается по границам', () => {
    const huge: [number, number][] = [[-500, -500], [500, -500], [500, 500], [-500, 500]];
    const out = clipToRect(huge, ...rect);
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const [x, z] of out) {
      expect(x).toBeGreaterThanOrEqual(-100);
      expect(x).toBeLessThanOrEqual(100);
      expect(z).toBeGreaterThanOrEqual(-100);
      expect(z).toBeLessThanOrEqual(100);
    }
  });

  it('полигон целиком снаружи — пусто', () => {
    const away: [number, number][] = [[200, 200], [300, 200], [300, 300], [200, 300]];
    expect(clipToRect(away, ...rect)).toHaveLength(0);
  });
});

describe('terrain importer: тип листвы', () => {
  it('leaf_type определяет форму дерева', () => {
    expect(leafKind({ leaf_type: 'needleleaved' })).toBe('needle');
    expect(leafKind({ leaf_type: 'broadleaved' })).toBe('broad');
    expect(leafKind({ wood: 'coniferous' })).toBe('needle');
    expect(leafKind(undefined)).toBe('mixed');
  });
});

describe('terrain importer: сборка колец мультиполигона', () => {
  const ll = (lat: number, lng: number) => ({ lat, lng });

  it('куски границы склеиваются в замкнутое кольцо', () => {
    // Квадрат, разрезанный на три незамкнутых куска — как в OSM
    const parts = [
      [ll(0, 0), ll(0, 10)],
      [ll(0, 10), ll(10, 10)],
      [ll(10, 10), ll(10, 0), ll(0, 0)],
    ];
    const rings = stitchRings(parts);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4); // замыкающая вершина снята
  });

  it('кусок с обратным направлением разворачивается', () => {
    const parts = [
      [ll(0, 0), ll(0, 10)],
      [ll(10, 10), ll(0, 10)],        // задом наперёд
      [ll(10, 10), ll(10, 0), ll(0, 0)],
    ];
    expect(stitchRings(parts)).toHaveLength(1);
  });

  it('незамкнутый обрывок отбрасывается, а не превращается в полигон', () => {
    // Раньше такой обрывок замыкался сам на себя и «затапливал» карту
    expect(stitchRings([[ll(0, 0), ll(0, 10), ll(5, 20)]])).toHaveLength(0);
  });

  it('несколько независимых колец собираются раздельно', () => {
    const parts = [
      [ll(0, 0), ll(0, 1), ll(1, 1), ll(1, 0), ll(0, 0)],
      [ll(5, 5), ll(5, 6), ll(6, 6), ll(6, 5), ll(5, 5)],
    ];
    expect(stitchRings(parts)).toHaveLength(2);
  });
});

describe('terrain importer: обрезка русла по краю площадки', () => {
  const R = [0, 100, 0, 100] as const;

  it('отрезок внутри — не меняется', () => {
    const r = clipSegmentToRect([10, 10], [90, 90], 5, 15, ...R)!;
    expect(r.p1).toEqual([10, 10]);
    expect(r.p2).toEqual([90, 90]);
    expect(r.l1).toBe(5);
    expect(r.l2).toBe(15);
  });

  it('отрезок наружу — обрезается, отметка интерполируется', () => {
    // Из центра за правый край: обрезается ровно на границе x=100
    const r = clipSegmentToRect([50, 50], [150, 50], 10, 20, ...R)!;
    expect(r.p2[0]).toBeCloseTo(100);
    expect(r.l2).toBeCloseTo(15); // половина пути → середина между 10 и 20
  });

  it('отрезок целиком снаружи — null', () => {
    expect(clipSegmentToRect([200, 200], [300, 300], 1, 2, ...R)).toBeNull();
  });

  it('отрезок пересекает площадку насквозь', () => {
    const r = clipSegmentToRect([-50, 50], [150, 50], 0, 100, ...R)!;
    expect(r.p1[0]).toBeCloseTo(0);
    expect(r.p2[0]).toBeCloseTo(100);
  });
});
