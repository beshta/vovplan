/**
 * Раскладка ограждения: ломаная по земле → пролёты готовых секций.
 *
 * Забор не тянется резиновой лентой — он собирается из секций одинаковой
 * длины, и на каждом звене ломаной набор начинается заново: на углу секцию
 * не согнёшь. Остаток звена закрывается подрезанной секцией, как на площадке.
 *
 * Математика вынесена сюда и покрыта тестами по той же причине, что и правка
 * высот: ошибка здесь не падает, а молча ставит забор мимо земли — и заметить
 * это можно только глазами, случайно и поздно.
 */

export type FenceType = 'FAN_BARRIER' | 'MESH_3D' | 'CONCRETE';

/**
 * Короче этого не бывает ни звена, ни остатка (метры).
 *
 * Два щелчка в одну точку дают звено нулевой длины: направление у него
 * не определено, и секция уехала бы в NaN. Остаток в пару сантиметров —
 * не подрезанная секция, а заусенец поперёк забора.
 */
const MIN_SPAN = 0.15;

/** Коробчатая деталь секции в её собственных осях, метры. */
export interface SectionPart {
  /** Габарит: [вдоль пролёта, вверх, поперёк] */
  size: [number, number, number];
  /** Центр детали: x — от середины пролёта, y — от земли, z — поперёк */
  at: [number, number, number];
}

export interface FenceTypeSpec {
  label: string;
  /** Длина одной секции, метры */
  sectionLength: number;
  /** Типовая высота, метры — её можно переопределить у конкретного ограждения */
  height: number;
  /** Цвет несущих деталей */
  color: string;
  /** Есть ли у типа полотно сетки (рисуется плоскостью с прозрачностью, не прутками) */
  mesh: boolean;
  /** Детали секции при её типовых размерах */
  parts: (length: number, height: number) => SectionPart[];
}

/**
 * Три типа с их настоящими габаритами.
 *
 * Прутки фан-барьера — тонкие коробки: их два десятка на секцию, и все копии
 * всех пролётов уходят в один вызов отрисовки. А вот сварная сетка 50×200 мм
 * прутками не рисуется вовсе: на секцию 2,5×2,0 это сотни цилиндров, поэтому
 * полотно — одна плоскость с прозрачной текстурой.
 */
export const FENCE_TYPES: Record<FenceType, FenceTypeSpec> = {
  FAN_BARRIER: {
    label: 'Фан-барьер',
    sectionLength: 2.2,
    height: 1.1,
    color: '#b9bec6',
    mesh: false,
    parts: (L, H) => {
      const barBottom = 0.12;
      const barHeight = H - barBottom - 0.05;
      const parts: SectionPart[] = [
        // Рама: нижний и верхний пояса + стойки по краям
        { size: [L, 0.04, 0.04], at: [0, barBottom, 0] },
        { size: [L, 0.05, 0.05], at: [0, H - 0.025, 0] },
        { size: [0.05, H, 0.05], at: [-(L / 2 - 0.025), H / 2, 0] },
        { size: [0.05, H, 0.05], at: [L / 2 - 0.025, H / 2, 0] },
        // Ножки-сани: барьер не вкапывают, он стоит на них
        { size: [0.06, 0.04, 0.7], at: [-(L / 2 - 0.15), 0.02, 0] },
        { size: [0.06, 0.04, 0.7], at: [L / 2 - 0.15, 0.02, 0] },
      ];
      // Вертикальные прутки шагом 10 см
      const count = Math.max(2, Math.round(L / 0.1) - 1);
      const step = L / (count + 1);
      for (let i = 1; i <= count; i++) {
        parts.push({
          size: [0.018, barHeight, 0.018],
          at: [-L / 2 + step * i, barBottom + barHeight / 2, 0],
        });
      }
      return parts;
    },
  },

  MESH_3D: {
    label: '3D-решётка',
    sectionLength: 2.5,
    height: 2.0,
    color: '#3f6b45',
    mesh: true,
    parts: (L, H) => [
      // Столбы 60×40 мм, чуть выше полотна
      { size: [0.06, H + 0.08, 0.04], at: [-(L / 2 - 0.03), (H + 0.08) / 2, 0] },
      { size: [0.06, H + 0.08, 0.04], at: [L / 2 - 0.03, (H + 0.08) / 2, 0] },
      // Рёбра жёсткости — то, из-за чего решётку и зовут 3D
      { size: [L, 0.014, 0.03], at: [0, 0.18, 0] },
      { size: [L, 0.014, 0.03], at: [0, H / 2, 0] },
      { size: [L, 0.014, 0.03], at: [0, H - 0.15, 0] },
    ],
  },

  CONCRETE: {
    label: 'Бетонный',
    sectionLength: 2.0,
    height: 2.2,
    color: '#a3a29c',
    mesh: false,
    parts: (L, H) => [
      // Стакан (основание) и плита в нём
      { size: [L - 0.15, 0.22, 0.4], at: [0, 0.11, 0] },
      { size: [L - 0.15, H - 0.22, 0.16], at: [0, 0.22 + (H - 0.22) / 2, 0] },
      // Стойка на стыке плит — половина уходит в соседний пролёт
      { size: [0.18, H, 0.22], at: [L / 2, H / 2, 0] },
    ],
  },
};

/** Один пролёт: готовая к постановке секция */
export interface FenceSpan {
  /** Середина пролёта по низу: [x, y, z] в метрах сцены */
  center: [number, number, number];
  /** Поворот вокруг вертикали, радианы */
  yaw: number;
  /** Длина пролёта: у последнего в звене — остаток, он короче секции */
  length: number;
  /** Высота с добавкой на перепад под секцией */
  height: number;
}

export interface LayoutOptions {
  sectionLength: number;
  height: number;
  /** Замкнуть контур: добавить пролёт от последней вершины к первой */
  closed?: boolean;
  /**
   * Высота земли в точке. Без неё высоты берутся линейной интерполяцией
   * между вершинами — а на холме середина длинного звена лежит заметно выше
   * прямой, соединяющей его концы, и секции там висят в воздухе.
   */
  ground?: (x: number, z: number) => number;
}

/**
 * Разбивает ломаную на пролёты.
 *
 * Каждый пролёт ставится по своим двум концам: низ — на нижнем из них, а
 * высота растёт на перепад между ними. Так верх остаётся ровным (секции их
 * и делают ровными), нижний конец стоит на земле, а на верхнем низ секции
 * уходит в грунт — ровно как на настоящем откосе, где панели не наклоняют,
 * а ступенькой смещают.
 */
export function layoutFence(
  points: readonly [number, number, number][],
  opts: LayoutOptions,
): FenceSpan[] {
  const { sectionLength, height, closed = false, ground } = opts;
  if (points.length < 2 || sectionLength <= 0) return [];

  // Замыкание — это ещё одно звено, а не особый случай в расчёте
  const verts = closed && points.length > 2 ? [...points, points[0]] : [...points];
  const spans: FenceSpan[] = [];

  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1];
    const b = verts[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    // Длина по горизонтали: на 12° уклона настоящая длина больше на 2%,
    // и растягивать ради этого секции незачем
    const len = Math.hypot(dx, dz);
    if (len < MIN_SPAN) continue;

    // Ry(yaw) должен перевести локальную ось X в направление звена
    const yaw = Math.atan2(-dz, dx);

    const whole = Math.floor(len / sectionLength);
    const rest = len - whole * sectionLength;
    const pieces: { start: number; length: number }[] = [];
    for (let k = 0; k < whole; k++) {
      pieces.push({ start: k * sectionLength, length: sectionLength });
    }
    if (rest >= MIN_SPAN) pieces.push({ start: whole * sectionLength, length: rest });

    for (const piece of pieces) {
      const t0 = piece.start / len;
      const t1 = (piece.start + piece.length) / len;
      const x0 = a[0] + dx * t0;
      const z0 = a[2] + dz * t0;
      const x1 = a[0] + dx * t1;
      const z1 = a[2] + dz * t1;
      const y0 = ground ? ground(x0, z0) : a[1] + (b[1] - a[1]) * t0;
      const y1 = ground ? ground(x1, z1) : a[1] + (b[1] - a[1]) * t1;

      spans.push({
        center: [(x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2],
        yaw,
        length: piece.length,
        height: height + Math.abs(y1 - y0),
      });
    }
  }

  return spans;
}

/** Длина ограждения по земле, метры — то, что считают в смете */
export function fenceLength(points: readonly [number, number, number][], closed = false): number {
  const verts = closed && points.length > 2 ? [...points, points[0]] : [...points];
  let total = 0;
  for (let i = 1; i < verts.length; i++) {
    total += Math.hypot(verts[i][0] - verts[i - 1][0], verts[i][2] - verts[i - 1][2]);
  }
  return total;
}
