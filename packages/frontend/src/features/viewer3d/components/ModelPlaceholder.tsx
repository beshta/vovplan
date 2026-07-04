import { Html } from '@react-three/drei';

/**
 * Lightweight 3D placeholder shown while the real model loads.
 * Shows a pin marker + object name at the object's position.
 */
export default function ModelPlaceholder({
  position,
  name,
  color = '#3b82f6',
}: {
  position: [number, number, number];
  name: string;
  color?: string;
}) {
  return (
    <group position={position}>
      {/* Pin pole */}
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 2, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Pin head */}
      <mesh position={[0, 2.2, 0]} castShadow>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {/* Label */}
      <Html position={[0, 2.8, 0]} center distanceFactor={20}>
        <div className="px-2 py-1 bg-slate-900/90 text-white text-xs rounded whitespace-nowrap pointer-events-none select-none">
          {name}
        </div>
      </Html>
    </group>
  );
}
