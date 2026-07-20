import { useEffect } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useViewerStore } from '../stores/viewerStore';

const UTILITY_COLORS: Record<string, string> = {
  WATER: '#2563eb', GAS: '#f59e0b', ELECTRIC: '#dc2626',
  SEWAGE: '#7c3aed', TELECOM: '#10b981', HEAT: '#ea580c',
};

/**
 * 3D-часть рисования инженерной сети: ловит клики по рельефу (добавляет
 * точки в стор) и рисует превью-линию + точки + метку длины.
 * Панель управления вынесена в HUD (UtilityDrawPanel) — вне Canvas,
 * чтобы кнопки не перекрывались HUD-оверлеем.
 */
export default function UtilityCreator() {
  const points = useViewerStore((s) => s.utilityDraft.points);
  const type = useViewerStore((s) => s.utilityDraft.type);
  const addDraftPoint = useViewerStore((s) => s.addDraftPoint);
  const setGroundHandlers = useViewerStore((s) => s.setGroundHandlers);

  useEffect(() => {
    setGroundHandlers({ onClick: (pt) => addDraftPoint(pt) });
    return () => setGroundHandlers(null);
  }, [setGroundHandlers, addDraftPoint]);

  const color = UTILITY_COLORS[type] ?? '#2563eb';

  const totalLength = points.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    const p = points[i - 1];
    return sum + Math.sqrt((pt[0] - p[0]) ** 2 + (pt[1] - p[1]) ** 2 + (pt[2] - p[2]) ** 2);
  }, 0);

  const previewGeom = points.length >= 2
    ? new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)))
    : null;

  return (
    <>
      {previewGeom && (
        <line>
          <primitive object={previewGeom} attach="geometry" />
          <lineBasicMaterial color={color} linewidth={3} />
        </line>
      )}
      {points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      {points.length > 0 && (
        <Html position={points[points.length - 1]} center distanceFactor={20} zIndexRange={[20, 0]}>
          <div className="bg-slate-900/90 text-white text-xs rounded-lg px-2 py-1 shadow-xl whitespace-nowrap pointer-events-none">
            {totalLength > 0 ? `${totalLength.toFixed(1)}м` : 'кликайте по сцене'}
          </div>
        </Html>
      )}
    </>
  );
}
