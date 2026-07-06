import { useMemo } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import type { UtilityNetworkData } from '../types';

/**
 * Renders all engineering utility networks in the 3D scene.
 *
 * Each network is a 3D polyline rendered as a tube/cylinder along its geometry.
 * Underground networks are rendered below the terrain (y = -depth).
 * Overhead networks are rendered above ground (poles + wires).
 *
 * Color-coded by type:
 *   WATER=blue, GAS=yellow, ELECTRIC=red, SEWAGE=purple, TELECOM=green, HEAT=orange
 */
export default function UtilityNetworks3D() {
  const utilities = useViewerStore((s) => s.utilities);
  const visibleUtilityTypes = useViewerStore((s) => s.visibleUtilityTypes);
  const xrayMode = useViewerStore((s) => s.xrayMode);

  // Filter by visibility toggle
  const visibleUtilities = utilities.filter((u) => visibleUtilityTypes[u.type]);

  return (
    <group>
      {visibleUtilities.map((util) => (
        <UtilityPipe key={util.id} data={util} xray={xrayMode} />
      ))}
    </group>
  );
}

/** Render a single utility network as a 3D tube along its geometry */
function UtilityPipe({ data, xray }: { data: UtilityNetworkData; xray: boolean }) {
  // Build a CatmullRom curve through the geometry points
  const { curve, tubeGeometry } = useMemo(() => {
    // For underground networks, subtract burial depth from y coordinate
    const depthOffset = data.location === 'UNDERGROUND' && data.depth ? -data.depth : 0;
    const points = data.geometry.map(
      ([x, y, z]) => new THREE.Vector3(x, y + depthOffset, z),
    );

    if (points.length < 2) return { curve: null, tubeGeometry: null };

    const curve = new THREE.CatmullRomCurve3(points);
    // Tube radius: based on diameter (mm → scene units), minimum 0.05
    const radius = data.diameter ? Math.max(data.diameter / 1000 * 0.3, 0.08) : 0.15;
    const tubeGeometry = new THREE.TubeGeometry(curve, points.length * 8, radius, 8, false);

    return { curve, tubeGeometry };
  }, [data.geometry, data.depth, data.diameter, data.location]);

  if (!tubeGeometry) return null;

  // Opacity: transparent in X-Ray mode, opaque otherwise
  const opacity = xray ? 0.6 : 0.95;

  return (
    <group>
      {/* The pipe itself */}
      <mesh geometry={tubeGeometry} castShadow={!xray}>
        <meshStandardMaterial
          color={data.color}
          emissive={data.color}
          emissiveIntensity={xray ? 0.5 : 0.15}
          roughness={0.6}
          metalness={0.3}
          transparent={xray}
          opacity={opacity}
        />
      </mesh>

      {/* For overhead networks: add support poles at each point */}
      {data.location === 'OVERHEAD' &&
        data.geometry.map((pt, i) => (
          <mesh key={`pole-${i}`} position={[pt[0], pt[1] + 3, pt[2]]}>
            <cylinderGeometry args={[0.08, 0.1, 6, 6]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.8} />
          </mesh>
        ))}

      {/* Label marker at midpoint */}
      {curve && (
        <mesh position={curve.getPoint(0.5)}>
          <sphereGeometry args={[0.25, 8, 8]} />
          <meshBasicMaterial color={data.color} />
        </mesh>
      )}
    </group>
  );
}
