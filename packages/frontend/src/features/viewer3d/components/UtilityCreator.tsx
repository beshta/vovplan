import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useViewerStore } from '../stores/viewerStore';
import { utilitiesApi } from '../../../shared/api';

const UTILITY_COLORS: Record<string, string> = {
  WATER: '#2563eb',
  GAS: '#f59e0b',
  ELECTRIC: '#dc2626',
  SEWAGE: '#7c3aed',
  TELECOM: '#10b981',
  HEAT: '#ea580c',
};

/**
 * Interactive utility network creator.
 *
 * Usage:
 * 1. Select type (WATER, GAS, ELECTRIC, etc.) from the floating panel
 * 2. Select location (UNDERGROUND / OVERHEAD)
 * 3. Click on the terrain to place points
 * 4. Click "Create" to save the polyline as a utility network
 *
 * Shows a preview line + distance measurement while drawing.
 */

interface UtilityCreatorProps {
  projectId: string;
}

export default function UtilityCreator({ projectId }: UtilityCreatorProps) {
  const [points, setPoints] = useState<[number, number, number][]>([]);
  const [utilType, setUtilType] = useState<string>('WATER');
  const [location, setLocation] = useState<'UNDERGROUND' | 'OVERHEAD'>('UNDERGROUND');
  const [depth, setDepth] = useState(1.5);
  const [diameter, setDiameter] = useState(200);

  const setUtilities = useViewerStore((s) => s.setUtilities);
  const setGroundHandlers = useViewerStore((s) => s.setGroundHandlers);

  // Регистрируем приём кликов по рельефу (Scene рейкастит террейн сам)
  useEffect(() => {
    setGroundHandlers({
      onClick: (pt) => setPoints((prev) => [...prev, pt]),
    });
    return () => setGroundHandlers(null);
  }, [setGroundHandlers]);

  const handleUndo = () => setPoints((prev) => prev.slice(0, -1));
  const handleClear = () => setPoints([]);

  const handleCreate = async () => {
    if (points.length < 2) return;
    try {
      const color = UTILITY_COLORS[utilType];
      await utilitiesApi.create(projectId, {
        name: `${utilType} ${new Date().toLocaleTimeString('ru-RU')}`,
        type: utilType as any,
        location,
        geometry: points,
        depth: location === 'UNDERGROUND' ? depth : undefined,
        diameter,
        material: 'steel',
        color,
      });
      // Refresh utilities list
      const updated = await utilitiesApi.list(projectId);
      setUtilities(updated.data.map((u: any) => ({
        id: u.id, name: u.name, type: u.type, location: u.location,
        geometry: u.geometry, depth: u.depth, diameter: u.diameter,
        material: u.material, color: u.color,
      })));
      setPoints([]);
    } catch (err) {
      console.error('Failed to create utility:', err);
    }
  };

  // Total length of preview line
  const totalLength = points.reduce((sum, pt, i) => {
    if (i === 0) return 0;
    const prev = points[i - 1];
    return sum + Math.sqrt(
      (pt[0] - prev[0]) ** 2 + (pt[1] - prev[1]) ** 2 + (pt[2] - prev[2]) ** 2,
    );
  }, 0);

  const previewGeom = points.length >= 2
    ? new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)))
    : null;

  return (
    <>
      {/* Preview line */}
      {previewGeom && (
        <line>
          <primitive object={previewGeom} attach="geometry" />
          <lineBasicMaterial color={UTILITY_COLORS[utilType]} linewidth={3} />
        </line>
      )}

      {/* Preview points */}
      {points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color={UTILITY_COLORS[utilType]} />
        </mesh>
      ))}

      {/* Distance label at last point */}
      {points.length > 0 && (
        <Html position={points[points.length - 1]} center distanceFactor={20} zIndexRange={[20, 0]}>
          <div className="bg-slate-900/90 text-white text-xs rounded-lg px-2 py-1 shadow-xl whitespace-nowrap pointer-events-none">
            {totalLength > 0 ? `${totalLength.toFixed(1)}м` : '0м'}
          </div>
        </Html>
      )}

      {/* Control panel — прибита к правому верхнему углу экрана,
          а не к мировым координатам (раньше болталась по центру сцены) */}
      <Html fullscreen prepend zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className="absolute right-3 top-20 pointer-events-auto glass p-3.5 w-72 max-w-[calc(100vw-5rem)] select-none">
          <h3 className="hud-title mb-2.5">🔧 Создание сети</h3>

          {/* Type selector */}
          <div className="grid grid-cols-3 gap-1 mb-2">
            {Object.entries(UTILITY_COLORS).map(([type, color]) => (
              <button
                key={type}
                onClick={() => setUtilType(type)}
                className={`px-1 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  utilType === type ? 'ring-2 ring-white/30' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
                style={utilType === type ? { backgroundColor: color, color: '#fff' } : {}}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: color }} />
                {type}
              </button>
            ))}
          </div>

          {/* Location */}
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setLocation('UNDERGROUND')}
              className={`flex-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                location === 'UNDERGROUND' ? 'bg-vovplan-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >⬇ Подземная</button>
            <button
              onClick={() => setLocation('OVERHEAD')}
              className={`flex-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                location === 'OVERHEAD' ? 'bg-vovplan-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >⬆ Надземная</button>
          </div>

          {/* Depth (underground only) */}
          {location === 'UNDERGROUND' && (
            <label className="block mb-1 text-xs text-slate-500">
              Глубина: {depth}м
              <input type="range" min="0.5" max="5" step="0.5" value={depth}
                onChange={(e) => setDepth(parseFloat(e.target.value))}
                className="w-full" />
            </label>
          )}

          {/* Diameter */}
          <label className="block mb-2 text-xs text-slate-500">
            Диаметр: {diameter}мм
            <input type="range" min="50" max="1000" step="50" value={diameter}
              onChange={(e) => setDiameter(parseInt(e.target.value))}
              className="w-full" />
          </label>

          {/* Points info */}
          <div className="text-xs text-slate-500 mb-2">
            Точек: {points.length} · Длина: {totalLength.toFixed(1)}м
          </div>

          {/* Actions */}
          <div className="flex gap-1">
            <button onClick={handleUndo} disabled={points.length === 0}
              className="flex-1 px-2 py-1 bg-white/5 text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
              ↶ Отмена
            </button>
            <button onClick={handleClear} disabled={points.length === 0}
              className="flex-1 px-2 py-1 bg-white/5 text-slate-300 rounded-lg text-xs font-medium hover:bg-white/10 disabled:opacity-40 transition-colors">
              ✕ Очистить
            </button>
            <button onClick={handleCreate} disabled={points.length < 2}
              className="flex-1 px-2 py-1 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-500 disabled:opacity-40 transition-colors">
              ✓ Создать
            </button>
          </div>

          <p className="text-[10px] text-slate-400 mt-2">Кликайте по сцене — точки соединятся в линию сети.</p>
        </div>
      </Html>
    </>
  );
}
