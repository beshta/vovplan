import { useRef, useEffect, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import type { SceneObjectData } from '../types';
import ModelPlaceholder from './ModelPlaceholder';
import LodModel from './LodModel';
import { sceneApi } from '../../../shared/api';

interface Props {
  data: SceneObjectData;
  currentUserId: string;
  projectId: string;
}

/**
 * A single placed object in the 3D scene.
 *
 * Features:
 * - Click to select (any mode) → ObjectInfoPanel
 * - TransformControls: translate/rotate/uniform-scale (edit mode)
 * - Camera target follows selected object
 * - OrbitControls disabled during transform
 * - Reset to original transform
 * - Undo/redo history (Ctrl+Z / Ctrl+Shift+Z)
 */
export default function SceneObject({ data, currentUserId, projectId }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const mode = useViewerStore((s) => s.mode);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const selectObject = useViewerStore((s) => s.selectObject);
  const updateObject = useViewerStore((s) => s.updateObject);
  const transformMode = useViewerStore((s) => s.transformMode);
  const showHidden = useViewerStore((s) => s.showHidden);
  const modelCache = useViewerStore((s) => s.modelCache);
  const pushHistory = useViewerStore((s) => s.pushHistory);
  const [hovered, setHovered] = useState(false);

  if (data.hidden && !showHidden) return null;

  const isSelected = selectedObjectId === data.id;

  const canEdit =
    mode === 'master-edit' ||
    (mode === 'partition-edit' && data.authorId === currentUserId);

  const canTransform = canEdit && isSelected;

  // Click — works in ALL modes
  const handleClick = (e: any) => {
    e.stopPropagation();
    selectObject(data.id);
  };

  // Save transform to store + API + history after dragging
  // For scale mode: enforce uniform (proportional) scaling
  const handleTransformEnd = () => {
    if (!groupRef.current) return;
    const pos = groupRef.current.position;
    const rot = groupRef.current.rotation;
    let scl = groupRef.current.scale;

    // Uniform scale: use average of x,y,z to keep proportions
    let newScl: [number, number, number];
    if (transformMode === 'scale') {
      const avg = (scl.x + scl.y + scl.z) / 3;
      newScl = [avg, avg, avg];
      groupRef.current.scale.set(avg, avg, avg);
    } else {
      newScl = [scl.x, scl.y, scl.z];
    }

    const newPos: [number, number, number] = [pos.x, pos.y, pos.z];
    const newRot: [number, number, number] = [rot.x, rot.y, rot.z];

    // Push old+new state to history
    pushHistory({
      objectId: data.id,
      oldPosition: data.position,
      oldRotation: data.rotation,
      oldScale: data.scale,
      newPosition: newPos,
      newRotation: newRot,
      newScale: newScl,
    });

    updateObject(data.id, { position: newPos, rotation: newRot, scale: newScl });

    sceneApi.updateObject(projectId, data.id, {
      position: newPos,
      rotation: newRot,
      scale: newScl,
    }).catch((err) => console.error('Failed to save transform:', err));
  };

  // Sync group transform when data changes externally
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(...data.position);
    groupRef.current.rotation.set(...data.rotation);
    groupRef.current.scale.set(...data.scale);
  }, [data.position, data.rotation, data.scale]);

  const model = data.modelId ? modelCache[data.modelId] : undefined;
  const color = data.hidden ? '#f59e0b' : isSelected ? '#10b981' : hovered ? '#60a5fa' : '#3b82f6';

  return (
    <>
      <group
        ref={groupRef}
        position={data.position}
        rotation={data.rotation}
        scale={data.scale}
        onClick={handleClick}
        onPointerOver={(e: any) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
      >
        {model?.glbUrl ? (
          <LodModel
            glbUrl={model.glbUrl}
            lod1Url={model.lod1Url}
            lod2Url={model.lod2Url}
            name={data.name}
          />
        ) : (
          <ModelPlaceholder position={[0, 0, 0]} name={data.name} color={color} />
        )}

        {/* Selection indicator */}
        {isSelected && !data.hidden && (
          <mesh position={[0, 1, 0]}>
            <sphereGeometry args={[2.5, 16, 16]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={0.4} />
          </mesh>
        )}

        {/* Hover indicator */}
        {hovered && !isSelected && !data.hidden && (
          <mesh position={[0, 1, 0]}>
            <sphereGeometry args={[2.3, 16, 16]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={0.25} />
          </mesh>
        )}

        {/* Invisible click target */}
        <mesh position={[0, 1, 0]}>
          <sphereGeometry args={[2.8, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* TransformControls — camera lock during drag */}
      {canTransform && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode={transformMode}
          onObjectChange={handleTransformEnd}
          onMouseDown={() => useViewerStore.getState().setCameraLocked(true)}
          onMouseUp={() => useViewerStore.getState().setCameraLocked(false)}
        />
      )}
    </>
  );
}
