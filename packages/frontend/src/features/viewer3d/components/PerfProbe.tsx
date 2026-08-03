import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useViewerStore } from '../stores/viewerStore';

/** Как часто обновлять числа, мс. Чаще смысла нет, а стор дёргать дорого. */
const INTERVAL = 500;

/**
 * Замер производительности сцены. Живёт внутри Canvas, потому что читает
 * gl.info рендерера, но в стор пишет раз в полсекунды: обновление на каждом
 * кадре само по себе роняло бы FPS, который мы измеряем.
 */
export default function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  const since = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    const elapsed = now - since.current;
    if (elapsed < INTERVAL) return;

    const info = gl.info;
    useViewerStore.getState().setPerfStats({
      fps: Math.round((frames.current * 1000) / elapsed),
      triangles: info.render.triangles,
      calls: info.render.calls,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });

    frames.current = 0;
    since.current = now;
  });

  return null;
}
