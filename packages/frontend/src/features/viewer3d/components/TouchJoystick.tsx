import { useRef, useState, useCallback } from 'react';
import { useViewerStore } from '../stores/viewerStore';

const SIZE = 120;   // диаметр базы джойстика
const KNOB = 48;    // диаметр ручки
const MAX = (SIZE - KNOB) / 2;

/**
 * Виртуальный джойстик для ходьбы в режиме «от первого лица» на тач-устройствах
 * (WASD там недоступен). Пишет нормализованный вектор в стор (fpMove);
 * FirstPersonView читает его наравне с клавиатурой. Осмотр — drag по остальному
 * экрану (обрабатывается в FirstPersonView, эта зона его перехватывает).
 */
export default function TouchJoystick() {
  const setFpMove = useViewerStore((s) => s.setFpMove);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  const update = useCallback((cx: number, cy: number) => {
    let dx = cx - origin.current.x;
    let dy = cy - origin.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX) { dx = (dx / dist) * MAX; dy = (dy / dist) * MAX; }
    setKnob({ x: dx, y: dy });
    // y-экранное вниз положительное → вперёд = -dy
    setFpMove({ x: dx / MAX, y: -dy / MAX });
  }, [setFpMove]);

  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    active.current = true;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    origin.current = { x: r.left + SIZE / 2, y: r.top + SIZE / 2 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (!active.current) return;
    e.stopPropagation();
    update(e.clientX, e.clientY);
  };
  const end = (e: React.PointerEvent) => {
    active.current = false;
    e.stopPropagation();
    setKnob({ x: 0, y: 0 });
    setFpMove({ x: 0, y: 0 });
  };

  return (
    <div
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className="pointer-events-auto rounded-full relative touch-none select-none"
      style={{
        width: SIZE, height: SIZE,
        background: 'rgba(15,23,42,0.4)',
        border: '1px solid rgba(255,255,255,0.15)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="absolute rounded-full bg-vovplan-600/80 border border-white/30"
        style={{
          width: KNOB, height: KNOB,
          left: SIZE / 2 - KNOB / 2 + knob.x,
          top: SIZE / 2 - KNOB / 2 + knob.y,
          transition: active.current ? 'none' : 'left 0.12s, top 0.12s',
        }}
      />
    </div>
  );
}
