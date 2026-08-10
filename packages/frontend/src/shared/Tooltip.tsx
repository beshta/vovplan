import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Подсказка при наведении в оформлении приложения.
 *
 * Системная подсказка браузера рисуется операционной системой: прямые углы,
 * чужой шрифт, свои цвета — в тёмной теме она остаётся светлой, и наоборот.
 * Здесь же скруглённая плашка того же вида, что и остальные всплывающие
 * панели, и она следует теме.
 *
 * Рисуется через портал в конец страницы: панель инструментов лежит в
 * контейнере с обрезкой по краям, и подсказка внутри неё обрезалась бы по
 * границе панели.
 */
export default function Tooltip({
  label,
  side = 'right',
  children,
}: {
  label: string;
  /** С какой стороны от элемента показывать */
  side?: 'right' | 'left' | 'top' | 'bottom';
  children: React.ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const box = anchor.current?.firstElementChild?.getBoundingClientRect();
    if (!box) return;
    const gap = 10;
    const spot = {
      right: { x: box.right + gap, y: box.top + box.height / 2 },
      left: { x: box.left - gap, y: box.top + box.height / 2 },
      top: { x: box.left + box.width / 2, y: box.top - gap },
      bottom: { x: box.left + box.width / 2, y: box.bottom + gap },
    }[side];
    setAt(spot);
  };

  // Смещение самой плашки: подводим её край к элементу, а не центр
  const shift = {
    right: 'translate(0, -50%)',
    left: 'translate(-100%, -50%)',
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
  }[side];

  return (
    <>
      <span
        ref={anchor}
        onPointerEnter={show}
        onPointerLeave={() => setAt(null)}
        // Подсказка не должна оставаться на экране после щелчка: инструмент
        // уже выбран, а плашка висела бы поверх сцены до увода курсора
        onPointerDown={() => setAt(null)}
        className="contents"
      >
        {children}
      </span>

      {at &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: at.x, top: at.y, transform: shift }}
            className="fixed z-[100] pointer-events-none px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap
                       bg-white/95 text-slate-700 ring-1 ring-slate-900/10 shadow-lg backdrop-blur-xl
                       dark:bg-slate-900/95 dark:text-slate-100 dark:ring-white/10"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
