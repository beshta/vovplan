import { useRef } from 'react';
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
 * Uses LodModel for distance-based detail switching.
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

  if (data.hidden && !showHidden) return null;

  const isSelected = selectedObjectId === data.id;

  const canEdit =
    mode === 'master-edit' ||
    (mode === 'partition-edit' && data.authorId === currentUserId);

  const canTransform = canEdit && isSelected;

  const handleClick = (e: any) => {
    e.stopPropagation();
    selectObject(data.id);
  };

  // Save transform to store + API
  const handleTransformEnd = () => {
    if (!groupRef.current) return;
    const pos = groupRef.current.position;
    const rot = groupRef.current.rotation;
    const scl = groupRef.current.scale;
    const newPos: [number, number, number] = [pos.x, pos.y, pos.z];
    const newRot: [number, number, number] = [rot.x, rot.y, rot.z];
    const newScl: [number, number, number] = [scl.x, scl.y, scl.z];

    updateObject(data.id, { position: newPos, rotation: newRot, scale: newScl });

    sceneApi.updateObject(projectId, data.id, {
      position: newPos,
      rotation: newRot,
      scale: newScl,
    });
  };

  // Look up model cache entry for this object's modelId
  const model = data.modelId ? modelCache[data.modelId] : undefined;
  const color = data.hidden ? '#f59e0b' : isSelected ? '#10b981' : '#3b82f6';

  return (
    <group
      ref={groupRef}
      position={data.position}
      rotation={data.rotation}
      scale={data.scale}
    >
      {/* Render LOD model or placeholder */}
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

      {/* Invisible hitbox for click detection */}
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
