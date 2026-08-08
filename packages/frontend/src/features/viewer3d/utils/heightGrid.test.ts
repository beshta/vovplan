import { describe, it, expect } from 'vitest';
import { buildHeightGrid } from './heightGrid';
import { TERRAIN_ADJUST_OFF } from '../../../shared/api';

/**
 * Правки рельефа искажают геометрию молча: ошибка здесь не падает, а просто
 * рисует другую местность. Проверяем, что каждая ручка делает ровно то, что
 * обещает подпись под ней.
 */

/** Пила: соседние точки скачут — на такой лучше всего видно сглаживание */
const saw = (x: number, y: number) => ((x + y) % 2 === 0 ? 0.2 : 0.8);
/** Наклон с юга на север */
const slope = (_x: number, y: number) => y / 15;

const W = 16;
const H = 16;
/** Участок 16×16 точек по метру: радиус сглаживания в метрах = в пикселях */
const SIZE = 15;

const build = (raw: (x: number, y: number) => number, adjust = TERRAIN_ADJUST_OFF) =>
  buildHeightGrid(raw, W, H, SIZE, SIZE, adjust);

/** Средний перепад между соседями по горизонтали — мера «зубчатости» */
function roughness(g: Float32Array): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W; x++) {
      sum += Math.abs(g[y * W + x] - g[y * W + x - 1]);
      n++;
    }
  }
  return sum / n;
}

const spread = (g: Float32Array) => Math.max(...g) - Math.min(...g);
const mean = (g: Float32Array) => g.reduce((a, b) => a + b, 0) / g.length;

describe('правка сетки высот', () => {
  it('без настроек отдаёт исходные высоты', () => {
    const g = build(slope);
    expect(g[0]).toBeCloseTo(0, 6);
    expect(g[15 * W]).toBeCloseTo(1, 6);
  });

  describe('сглаживание', () => {
    it('гасит зубцы', () => {
      const before = roughness(build(saw));
      const after = roughness(build(saw, { ...TERRAIN_ADJUST_OFF, smooth: 2 }));
      expect(after).toBeLessThan(before * 0.2);
    });

    it('не сдвигает площадку по высоте', () => {
      const before = build(saw);
      const after = build(saw, { ...TERRAIN_ADJUST_OFF, smooth: 3 });
      expect(mean(after)).toBeCloseTo(mean(before), 5);
    });

    it('сохраняет общий уклон', () => {
      // Ровный склон сглаживать нечего: он и так гладкий
      const after = build(slope, { ...TERRAIN_ADJUST_OFF, smooth: 2 });
      expect(after[8 * W] - after[2 * W]).toBeGreaterThan(0.3);
    });

    it('радиус меньше шага сетки ничего не меняет', () => {
      // 16 точек на 15 м — шаг метр; радиус 0.4 м округляется в ноль
      const before = build(saw);
      const after = build(saw, { ...TERRAIN_ADJUST_OFF, smooth: 0.4 });
      expect(roughness(after)).toBeCloseTo(roughness(before), 6);
    });
  });

  describe('выравнивание', () => {
    it('на единице даёт идеально ровную площадку', () => {
      const g = build(slope, { ...TERRAIN_ADJUST_OFF, level: 1 });
      expect(spread(g)).toBeCloseTo(0, 6);
    });

    it('на половине уменьшает перепад вдвое', () => {
      const before = spread(build(slope));
      const after = spread(build(slope, { ...TERRAIN_ADJUST_OFF, level: 0.5 }));
      expect(after).toBeCloseTo(before / 2, 5);
    });

    it('опирается на медиану, а не на среднее', () => {
      // Одна яма на краю: среднее она утянет вниз, медиану — нет.
      // Иначе выравнивание опускало бы всю площадку из-за одного обрыва.
      const pit = (x: number, y: number) => (x === 0 && y === 0 ? -20 : 0.5);
      const g = build(pit, { ...TERRAIN_ADJUST_OFF, level: 1 });
      expect(g[W * H - 1]).toBeCloseTo(0.5, 5);
    });
  });

  describe('вертикальный масштаб', () => {
    it('единица оставляет высоты как есть', () => {
      const before = build(slope);
      const after = build(slope, { ...TERRAIN_ADJUST_OFF, scale: 1 });
      expect(Array.from(after)).toEqual(Array.from(before));
    });

    it('половина уменьшает перепад вдвое', () => {
      const before = spread(build(slope));
      const after = spread(build(slope, { ...TERRAIN_ADJUST_OFF, scale: 0.5 }));
      expect(after).toBeCloseTo(before / 2, 5);
    });

    it('удерживает среднюю отметку', () => {
      // Иначе площадка при уплощении провалилась бы под уже расставленные
      // на ней объекты
      const before = build(slope);
      const after = build(slope, { ...TERRAIN_ADJUST_OFF, scale: 0.25 });
      expect(mean(after)).toBeCloseTo(mean(before), 5);
    });

    it('двойка усиливает перепад вдвое', () => {
      const before = spread(build(slope));
      const after = spread(build(slope, { ...TERRAIN_ADJUST_OFF, scale: 2 }));
      expect(after).toBeCloseTo(before * 2, 5);
    });
  });

  it('ручки складываются: сглаживание, потом выравнивание, потом масштаб', () => {
    const g = build(saw, { smooth: 3, level: 0.5, scale: 0.5 });
    // Пила сглажена, перепад ужат выравниванием и масштабом — почти ровно
    expect(spread(g)).toBeLessThan(spread(build(saw)) * 0.2);
    expect(Number.isFinite(mean(g))).toBe(true);
  });
});
