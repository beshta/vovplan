import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useViewerStore } from '../stores/viewerStore';
import { FenceRun } from './Fences3D';
import { FENCE_TYPES, planFence } from '../utils/fenceLayout';
import type { FenceData } from '../types';

/**
 * 3D-часть постановки ограждения: ловит клики по рельефу и показывает
 * черновик уже собранными секциями — тем же кодом, что рисует сохранённые.
 * Панель управления вынесена в HUD (FenceDrawPanel).
 */
export default function FenceCreator() {
  const draft = useViewerStore((s) => s.fenceDraft);
  const addFencePoint = useViewerStore((s) => s.addFencePoint);
  const setGroundHandlers = useViewerStore((s) => s.setGroundHandlers);
  const groundSampler = useViewerStore((s) => s.groundSampler);

  useEffect(() => {
    setGroundHandlers({ onPlace: (pt) => addFencePoint(pt) });
    return () => setGroundHandlers(null);
  }, [setGroundHandlers, addFencePoint]);

  const spec = FENCE_TYPES[draft.type];

  const preview: FenceData = useMemo(() => ({
    id: 'draft',
    name: 'Черновик',
    type: draft.type,
    geometry: draft.points,
    height: draft.height,
    closed: draft.closed,
  }), [draft.type, draft.points, draft.height, draft.closed]);

  // Пунктир по земле: показывает саму ломаную, включая последнее звено,
  // которое ещё короче секции и потому забором пока не закрыто
  const guide = useMemo(() => {
    const pts = draft.closed && draft.points.length > 2 ? [...draft.points, draft.points[0]] : draft.points;
    return pts.length >= 2
      ? new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1] + 0.05, p[2])))
      : null;
  }, [draft.points, draft.closed]);

  useEffect(() => () => guide?.dispose(), [guide]);

  // Та же раскладка, что уходит в геометрию: подсказка не должна обещать
  // секций больше, чем встанет на площадку
  const plan = useMemo(
    () => planFence(draft.points, {
      sectionLength: spec.sectionLength,
      height: draft.height ?? spec.height,
      closed: draft.closed,
      ground: groundSampler ?? undefined,
    }),
    [draft.points, draft.closed, draft.height, spec, groundSampler],
  );

  return (
    <>
      {draft.points.length >= 2 && <FenceRun data={preview} />}

      {guide && (
        <line>
          <primitive object={guide} attach="geometry" />
          <lineBasicMaterial color="#f59e0b" />
        </line>
      )}

      {draft.points.map((pt, i) => (
        <mesh key={i} position={[pt[0], pt[1] + 0.1, pt[2]]}>
          <sphereGeometry args={[0.25, 8, 8]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      ))}

      {draft.points.length > 0 && (
        <Html
          position={draft.points[draft.points.length - 1]}
          center
          distanceFactor={20}
          zIndexRange={[20, 0]}
        >
          <div className="bg-slate-900/90 text-white text-xs rounded-lg px-2 py-1 shadow-xl whitespace-nowrap pointer-events-none">
            {plan.length > 0 ? (
              <>
                {plan.length.toFixed(1)}м · {plan.spans.length} секц.
                {plan.remainder >= 0.15 && (
                  <span className="text-amber-300"> · проём {plan.remainder.toFixed(1)}м</span>
                )}
              </>
            ) : 'двойной клик по земле'}
          </div>
        </Html>
      )}
    </>
  );
}
