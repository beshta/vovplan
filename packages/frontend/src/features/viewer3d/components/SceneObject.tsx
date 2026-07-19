import { useRef, useEffect, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import type { SceneObjectData } from '../types';
import ModelPlaceholder from './ModelPlaceholder';
import LodModel from './LodModel';
import { sceneApi } from '../../../shared/api';
import { emitLiveTransform } from '../../collaboration/socket';

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
  const utilityDrawMode = useViewerStore((s) => s.utilityDrawMode);
  const cameraView = useViewerStore((s) => s.cameraView);
  const fpPoint = useViewerStore((s) => s.fpPoint);
  const [hovered, setHovered] = useState(false);

  // Активен «наземный» инструмент — клики должны проходить сквозь объекты
  // к террейну (рисование сетей/аннотаций, выбор точки первого лица)
  const groundToolActive =
    utilityDrawMode ||
    mode === 'annotate' ||
    (cameraView === 'first-person' && !fpPoint);

  // Transform snapshot at drag start (for history) + live-emit throttle
  const dragStart = useRef<{ position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null>(null);
  const lastEmit = useRef(0);

  if (data.hidden && !showHidden) return null;

  const isSelected = selectedObjectId === data.id;

  const canEdit =
    mode === 'master-edit' ||
    (mode === 'partition-edit' && data.authorId === currentUserId);

  // Locked objects cannot be transformed
  const canTransform = canEdit && isSelected && !data.locked;

  // Click — выбор объекта; при активном наземном инструменте событие
  // не глотаем (без stopPropagation оно дойдёт до террейна)
  const handleClick = (e: any) => {
    if (groundToolActive) return;
    e.stopPropagation();
    selectObject(data.id);
  };

  // Read current transform from the three.js group, enforcing uniform scale.
  const readTransform = (): {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  } => {
    const pos = groupRef.current!.position;
    const rot = groupRef.current!.rotation;
    const scl = groupRef.current!.scale;
    let newScl: [number, number, number];
    if (transformMode === 'scale') {
      const avg = (scl.x + scl.y + scl.z) / 3;
      newScl = [avg, avg, avg];
      groupRef.current!.scale.set(avg, avg, avg);
    } else {
      newScl = [scl.x, scl.y, scl.z];
    }
    return {
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z],
      scale: newScl,
    };
  };

  // During drag: update local store + relay a live (ephemeral) transform to peers (throttled).
  const handleObjectChange = () => {
    if (!groupRef.current) return;
    const t = readTransform();
    updateObject(data.id, t);

    const now = performance.now();
    if (now - lastEmit.current >= 50) {
      lastEmit.current = now;
      emitLiveTransform(projectId, data.id, t.position, t.rotation, t.scale);
    }
  };

  // On drag start: snapshot for undo history.
  const handleDragStart = () => {
    useViewerStore.getState().setCameraLocked(true);
    dragStart.current = {
      position: data.position,
      rotation: data.rotation,
      scale: data.scale,
    };
  };

  // On drag end: commit once to history + persist to API (server broadcasts to peers).
  const handleDragEnd = () => {
    useViewerStore.getState().setCameraLocked(false);
    if (!groupRef.current || !dragStart.current) return;
    const t = readTransform();
    const start = dragStart.current;
    dragStart.current = null;

    // No-op guard: skip if nothing actually moved
    const same =
      start.position.every((v, i) => v === t.position[i]) &&
      start.rotation.every((v, i) => v === t.rotation[i]) &&
      start.scale.every((v, i) => v === t.scale[i]);
    if (same) return;

    pushHistory({
      objectId: data.id,
      oldPosition: start.position,
      oldRotation: start.rotation,
      oldScale: start.scale,
      newPosition: t.position,
      newRotation: t.rotation,
      newScale: t.scale,
    });

    updateObject(data.id, t);

    sceneApi.updateObject(projectId, data.id, {
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
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
          onObjectChange={handleObjectChange}
          onMouseDown={handleDragStart}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  );
}
