import { useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { usePresenceStore } from './presenceStore';
import { emitCursor } from './socket';
import { useViewerStore } from '../viewer3d/stores/viewerStore';

/**
 * Renders other users' live cursors in the 3D scene and emits the local
 * user's ground cursor position (throttled) so peers can see it.
 *
 * The emit plane is disabled while drawing annotations / utility networks
 * so it never intercepts those tools' raycasts.
 */
export default function PeerLayer({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const cursors = usePresenceStore((s) => s.cursors);
  const selectObject = useViewerStore((s) => s.selectObject);
  const mode = useViewerStore((s) => s.mode);
  const utilityDrawMode = useViewerStore((s) => (s as any).utilityDrawMode);
  const lastEmit = useRef(0);

  const emitEnabled = mode !== 'annotate' && !utilityDrawMode;

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (now - lastEmit.current < 50) return; // ~20 Hz
    lastEmit.current = now;
    emitCursor(projectId, [e.point.x, e.point.y, e.point.z]);
  };

  return (
    <>
      {/* Invisible ground plane for cursor tracking (below objects, above terrain baseline) */}
      {emitEnabled && (
        <mesh
          position={[0, 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={handleMove}
          onPointerOut={() => emitCursor(projectId, null)}
          onClick={() => selectObject(null)}
        >
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* Other users' cursors */}
      {Object.values(cursors)
        .filter((c) => c.userId !== currentUserId)
        .map((c) => (
          <group key={c.socketId} position={c.point}>
            <mesh>
              <coneGeometry args={[0.6, 1.6, 12]} />
              <meshBasicMaterial color={c.color} />
            </mesh>
            <Html distanceFactor={40} position={[0, 1.4, 0]} zIndexRange={[20, 0]}>
              <div
                style={{
                  background: c.color,
                  color: '#fff',
                  padding: '1px 6px',
                  borderRadius: 6,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                }}
              >
                ●
              </div>
            </Html>
          </group>
        ))}
    </>
  );
}
