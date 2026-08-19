/**
 * Размер канваса публичного просмотра.
 *
 * На 3K и 4K сцена раньше растягивалась на весь экран: WebGL считал каждый
 * пиксель, кадр падал до единиц в секунду, а демпфер OrbitControls с таким
 * шагом времени уезжал в бесконечное приближение. Ограничиваем буфер:
 * большие экраны — 1920×1080, остальные — 1280×720, и никогда больше окна.
 */

/** Длинная сторона, с которой экран считается «больше 3K» */
export const PUBLIC_FRAME_3K = 2880;

export function publicFrameSize(
  screenLongEdge: number,
  availW: number,
  availH: number,
): { width: number; height: number } {
  const large = screenLongEdge >= PUBLIC_FRAME_3K;
  const capW = large ? 1920 : 1280;
  const capH = large ? 1080 : 720;
  return {
    width: Math.max(1, Math.min(Math.floor(availW), capW)),
    height: Math.max(1, Math.min(Math.floor(availH), capH)),
  };
}
