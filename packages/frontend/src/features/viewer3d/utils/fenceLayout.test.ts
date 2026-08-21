import { describe, it, expect } from 'vitest';
import { layoutFence, planFence, fenceLength, FENCE_TYPES } from './fenceLayout';

/**
 * Раскладка забора ошибается молча: секции просто встают мимо земли или мимо
 * ломаной, и увидеть это можно только глазами. Поэтому здесь проверяется
 * каждое обещание из подписи: длина секции, остаток, углы, уклон.
 */

const P = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

describe('раскладка ограждения', () => {
  it('прямое звено делится на целые секции без остатка', () => {
    const spans = layoutFence([P(0, 0, 0), P(10, 0, 0)], { sectionLength: 2.5, height: 2 });
    expect(spans).toHaveLength(4);
    expect(spans.every((s) => s.length === 2.5)).toBe(true);
    // Секции идут подряд от начала звена: середины через 2,5 м
    expect(spans.map((s) => s.center[0])).toEqual([1.25, 3.75, 6.25, 8.75]);
  });

  it('остаток остаётся проёмом — подрезанных секций не бывает', () => {
    const plan = planFence([P(0, 0, 0), P(11, 0, 0)], { sectionLength: 2.5, height: 2 });
    expect(plan.spans).toHaveLength(4);
    expect(plan.spans.every((s) => s.length === 2.5)).toBe(true);
    expect(plan.remainder).toBeCloseTo(1, 6);
    // Последняя целая секция кончается там, где начинается остаток
    const last = plan.spans[3];
    expect(last.center[0] + last.length / 2).toBeCloseTo(10, 6);
  });

  it('звено короче секции остаётся пустым и попадает в счёт коротких', () => {
    const plan = planFence([P(0, 0, 0), P(1.5, 0, 0)], { sectionLength: 2.5, height: 2 });
    expect(plan.spans).toHaveLength(0);
    expect(plan.shortEdges).toBe(1);
    expect(plan.remainder).toBeCloseTo(1.5, 6);
  });

  it('остатки считаются по каждому звену отдельно, а не по всей длине', () => {
    // Два звена по 6 м: на каждом по две секции 2,5 м и по метру остатка
    const plan = planFence([P(0, 0, 0), P(6, 0, 0), P(6, 0, 6)], { sectionLength: 2.5, height: 2 });
    expect(plan.spans).toHaveLength(4);
    expect(plan.length).toBeCloseTo(12, 6);
    expect(plan.remainder).toBeCloseTo(2, 6);
  });

  it('заусенец в пару сантиметров секцией не считается', () => {
    const spans = layoutFence([P(0, 0, 0), P(10.04, 0, 0)], { sectionLength: 2.5, height: 2 });
    expect(spans).toHaveLength(4);
  });

  it('на углу набор начинается заново — секцию не согнёшь', () => {
    // Два звена по 5 м: если бы считали ломаную целиком, вышло бы 4 секции
    // подряд, и одна из них легла бы поперёк угла
    const spans = layoutFence([P(0, 0, 0), P(5, 0, 0), P(5, 0, 5)], { sectionLength: 2.5, height: 2 });
    expect(spans).toHaveLength(4);
    expect(spans.filter((s) => s.yaw === spans[0].yaw)).toHaveLength(2);
  });

  it('поворот секции совпадает с направлением звена', () => {
    const along = layoutFence([P(0, 0, 0), P(5, 0, 0)], { sectionLength: 5, height: 2 })[0];
    const across = layoutFence([P(0, 0, 0), P(0, 0, 5)], { sectionLength: 5, height: 2 })[0];
    expect(along.yaw).toBeCloseTo(0, 6);
    expect(across.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('замкнутый контур получает пролёт от конца к началу', () => {
    const open = layoutFence([P(0, 0, 0), P(4, 0, 0), P(4, 0, 4)], { sectionLength: 2, height: 2 });
    const closed = layoutFence([P(0, 0, 0), P(4, 0, 0), P(4, 0, 4)], {
      sectionLength: 2, height: 2, closed: true,
    });
    // Замыкающая сторона — диагональ длиной 4√2, это ещё 2 полных + остаток
    expect(closed.length).toBeGreaterThan(open.length);
    expect(fenceLength([P(0, 0, 0), P(4, 0, 0), P(4, 0, 4)], true)).toBeCloseTo(8 + Math.hypot(4, 4), 6);
  });

  it('двойной щелчок в одну точку не даёт секцию с неопределённым поворотом', () => {
    const spans = layoutFence([P(3, 0, 3), P(3, 0, 3), P(8, 0, 3)], { sectionLength: 2.5, height: 2 });
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => Number.isFinite(s.yaw))).toBe(true);
  });

  it('на уклоне секция стоит низом на нижнем конце и не меняет размер', () => {
    // Земля поднимается на метр за каждые 10 м на восток
    const ground = (x: number) => x / 10;
    const spans = layoutFence([P(0, 0, 0), P(10, 1, 0)], { sectionLength: 5, height: 2, ground });

    expect(spans).toHaveLength(2);
    expect(spans[0].center[1]).toBeCloseTo(0, 6);
    expect(spans[1].center[1]).toBeCloseTo(0.5, 6);
    // Уклон двигает секцию ступенькой, но не тянет её: размер тот же
    expect(spans.every((s) => s.height === 2 && s.length === 5)).toBe(true);
  });

  it('без пробы грунта высоты берутся у концов звена', () => {
    const spans = layoutFence([P(0, 0, 0), P(10, 2, 0)], { sectionLength: 5, height: 2 });
    expect(spans[0].center[1]).toBeCloseTo(0, 6);
    expect(spans[1].center[1]).toBeCloseTo(1, 6);
  });

  it('одна точка ограждением не является', () => {
    expect(layoutFence([P(0, 0, 0)], { sectionLength: 2, height: 2 })).toEqual([]);
  });
});

describe('типы ограждений', () => {
  it('детали секции укладываются в её габарит', () => {
    for (const [name, spec] of Object.entries(FENCE_TYPES)) {
      const L = spec.sectionLength;
      const H = spec.height;
      for (const part of spec.parts(L, H)) {
        const top = part.at[1] + part.size[1] / 2;
        const bottom = part.at[1] - part.size[1] / 2;
        // Стойка на стыке плит специально выходит за половину длины —
        // проверяем только вертикаль, её нарушать нечему
        expect(bottom, `${name}: деталь уходит под землю`).toBeGreaterThanOrEqual(-0.001);
        expect(top, `${name}: деталь выше секции`).toBeLessThanOrEqual(H + 0.1);
      }
    }
  });

  it('прутки фан-барьера идут шагом около 10 см', () => {
    const spec = FENCE_TYPES.FAN_BARRIER;
    const bars = spec.parts(spec.sectionLength, spec.height).filter((p) => p.size[0] < 0.03);
    expect(bars.length).toBeGreaterThan(15);
    const step = bars[1].at[0] - bars[0].at[0];
    expect(step).toBeGreaterThan(0.08);
    expect(step).toBeLessThan(0.12);
  });
});
