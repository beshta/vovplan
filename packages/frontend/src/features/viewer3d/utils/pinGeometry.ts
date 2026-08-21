import * as THREE from 'three';

/**
 * Геометрия метки: кольцо на земле, капля остриём вниз, шар в её раструбе.
 *
 * Все три формы — общие на весь проект. Меток на площадке бывают сотни, и
 * своя геометрия у каждой означала бы сотни буферов в видеопамяти вместо
 * трёх; выделение и наведение меняют масштаб и цвет, а не форму.
 *
 * Граней намеренно мало. Метка — знак, а не модель: её читают силуэтом с
 * десятков метров, и разница между двенадцатью гранями и полусотней видна
 * только счётчику треугольников.
 */

/** Радиус головки капли, метры */
const HEAD_R = 0.7;
/** Высота центра головки над остриём: 2,2 радиуса дают узнаваемую каплю */
const HEAD_Y = HEAD_R * 2.2;
/** Где головка обрывается раструбом, радиан от вертикали */
const OPEN_ANGLE = Math.PI * 0.31;
/** Граней вращения у капли */
const LATHE_SEGMENTS = 14;

/** Верх метки — отсюда выезжает заметка */
export const PIN_TOP = HEAD_Y + HEAD_R;
/** Центр шара в раструбе головки */
export const PIN_BALL_Y = HEAD_Y;

/**
 * Профиль капли: остриё → касательная к головке → дуга головки → губа внутрь.
 *
 * Касательная, а не дуга от острия: у настоящей капли бока прямые, и именно
 * прямые бока отличают метку от груши.
 */
function dropProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];

  // Точка касания прямой, проведённой из острия к окружности головки
  const tangentLen = Math.sqrt(HEAD_Y * HEAD_Y - HEAD_R * HEAD_R);
  const touchX = (HEAD_R * tangentLen) / HEAD_Y;
  const touchY = (tangentLen * tangentLen) / HEAD_Y;

  // Не ноль: вырожденные треугольники на острие ломают нормали
  points.push(new THREE.Vector2(0.004, 0));
  points.push(new THREE.Vector2(touchX * 0.5, touchY * 0.5));
  points.push(new THREE.Vector2(touchX, touchY));

  const from = Math.atan2(touchX, touchY - HEAD_Y);
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const angle = from + ((OPEN_ANGLE - from) * i) / steps;
    points.push(new THREE.Vector2(HEAD_R * Math.sin(angle), HEAD_Y + HEAD_R * Math.cos(angle)));
  }

  // Губа: без неё край раструба выглядит вырезанным из бумаги
  const rim = HEAD_R * Math.sin(OPEN_ANGLE);
  points.push(new THREE.Vector2(rim * 0.8, HEAD_Y + HEAD_R * Math.cos(OPEN_ANGLE) - 0.07));

  return points;
}

export const PIN_DROP = new THREE.LatheGeometry(dropProfile(), LATHE_SEGMENTS);

/** Кольцо на земле — метка стоит в нём, а не висит над рельефом */
export const PIN_RING = (() => {
  const geo = new THREE.TorusGeometry(0.62, 0.1, 5, 14);
  geo.rotateX(-Math.PI / 2);
  return geo;
})();

/** Шар в раструбе: виден сверху и сбоку, наружу почти не выходит */
export const PIN_BALL = new THREE.SphereGeometry(0.5, 12, 8);
