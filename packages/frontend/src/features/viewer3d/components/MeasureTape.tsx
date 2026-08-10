import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Рулетка.
 *
 * Два щелчка по сцене — и между точками натягивается лента с насечками:
 * длинные через метр, короткие через полметра. Насечки важнее самой цифры:
 * по ним расстояние читается прямо на местности, без перевода взгляда на
 * подпись, и сразу видно, где именно проходит замер.
 *
 * Лента красная и рисуется поверх всего (`depthTest` выключен): мерить чаще
 * всего приходится между объектами, и лента, ныряющая внутрь модели, была бы
 * бесполезна.
 */

const COLOR = '#ef4444';
/** Длинная насечка — метр, короткая — полметра */
const MAJOR_STEP = 1;
const MINOR_STEP = 0.5;
/** Размах насечек поперёк ленты, м */
const MAJOR_SIZE = 0.35;
const MINOR_SIZE = 0.18;
/**
 * Предел числа насечек. На замере в километр их было бы четыре тысячи —
 * это тысячи отрезков в кадре ради штрихов мельче пикселя.
 */
const MAX_TICKS = 400;

export default function MeasureTape() {
  const points = useViewerStore((s) => s.measurePoints);

  const tape = useMemo(() => {
    if (points.length < 2) return null;

    const a = new THREE.Vector3(...points[0]);
    const b = new THREE.Vector3(...points[1]);
    const along = new THREE.Vector3().subVectors(b, a);
    const length = along.length();
    if (length < 1e-4) return null;
    along.normalize();

    // Поперечное направление: горизонтальное, если лента не отвесная, —
    // так насечки видно с обычного ракурса, сверху и сбоку
    const up = new THREE.Vector3(0, 1, 0);
    let across = new THREE.Vector3().crossVectors(along, up);
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.normalize();

    const ticks: [number, number, number][][] = [];
    const step = length / MINOR_STEP > MAX_TICKS ? length / MAX_TICKS : MINOR_STEP;
    const at = new THREE.Vector3();
    for (let d = step; d < length - 1e-6; d += step) {
      // Длинная — там, где укладывается целое число метров
      const isMajor = Math.abs(d / MAJOR_STEP - Math.round(d / MAJOR_STEP)) < 1e-6;
      const half = (isMajor ? MAJOR_SIZE : MINOR_SIZE) / 2;
      at.copy(a).addScaledVector(along, d);
      const p1 = at.clone().addScaledVector(across, half);
      const p2 = at.clone().addScaledVector(across, -half);
      ticks.push([[p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z]]);
    }

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    return { a, b, length, ticks, mid };
  }, [points]);

  // Первая точка уже поставлена, вторая ещё нет — показываем, откуда мерим
  if (points.length === 1) {
    return (
      <mesh position={points[0]}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color={COLOR} depthTest={false} />
      </mesh>
    );
  }

  if (!tape) return null;

  return (
    <group>
      <Line
        points={[tape.a, tape.b]}
        color={COLOR}
        lineWidth={2}
        depthTest={false}
        renderOrder={999}
      />
      {tape.ticks.map((seg, i) => (
        <Line
          key={i}
          points={seg}
          color={COLOR}
          lineWidth={1}
          depthTest={false}
          renderOrder={999}
        />
      ))}
      {[points[0], points[1]].map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshBasicMaterial color={COLOR} depthTest={false} />
        </mesh>
      ))}
      <Html position={tape.mid} center distanceFactor={40} zIndexRange={[100, 0]}>
        <div className="px-2 py-1 rounded-lg bg-red-600 text-white text-sm font-semibold whitespace-nowrap shadow-lg select-none">
          {tape.length < 10 ? tape.length.toFixed(2) : tape.length.toFixed(1)} м
        </div>
      </Html>
    </group>
  );
}
