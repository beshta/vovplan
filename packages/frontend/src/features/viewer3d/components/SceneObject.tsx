import { useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import type { SceneObjectData } from '../types';
import ModelPlaceholder from './ModelPlaceholder';

interface Props {
  data: SceneObjectData;
  currentUserId: string;
}

/**
 * A single placed object in the 3D scene.
 *
 * Behaviour depends on viewer mode:
 * - master-edit:   can transform ALL objects, see hidden ones
 * - partition-edit: can transform ONLY own objects (authorId === userId)
 * - view / annotate: read-only, click for info
 */
export default function SceneObject({ data, currentUserId }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const mode = useViewerStore((s) => s.mode);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const selectObject = useViewerStore((s) => s.selectObject);
  const updateObject = useViewerStore((s) => s.updateObject);
  const transformMode = useViewerStore((s) => s.transformMode);
  const showHidden = useViewerStore((s) => s.showHidden);

  // ── Visibility logic ───────────────────────
  if (data.hidden && !showHidden) return null;

  const isSelected = selectedObjectId === data.id;

  // ── Edit permissions ───────────────────────
  const canEdit =
    mode === 'master-edit' ||
    (mode === 'partition-edit' && data.authorId === currentUserId);

  const canTransform = canEdit && isSelected;

  // ── Click handler ──────────────────────────
  const handleClick = (e: any) => {
    e.stopPropagation();
    selectObject(data.id);
  };

  // ── Transform end → save to store ──────────
  const handleTransformEnd = () => {
    if (!groupRef.current) return;
    const pos = groupRef.current.position;
    const rot = groupRef.current.rotation;
    const scl = groupRef.current.scale;
    updateObject(data.id, {
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z],
      scale: [scl.x, scl.y, scl.z],
    });
  };

  const color = data.hidden ? '#f59e0b' : isSelected ? '#10b981' : '#3b82f6';

  return (
    <group
      ref={groupRef}
      position={data.position}
      rotation={data.rotation}
      scale={data.scale}
    >
      <ModelPlaceholder position={[0, 0, 0]} name={data.name} color={color} />

      {/* Invisible pick mesh for raycasting */}
      <mesh position={[0, 1, 0]} onClick={handleClick} visible={false}>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {canTransform && (
        <TransformControls
          object={groupRef as any}
          mode={transformMode}
          onObjectChange={handleTransformEnd}
        />
      )}
    </group>
  );
}
