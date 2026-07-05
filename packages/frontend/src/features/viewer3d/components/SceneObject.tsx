import { useRef, Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { TransformControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import type { SceneObjectData } from '../types';
import ModelPlaceholder from './ModelPlaceholder';
import { sceneApi } from '../../../shared/api';

interface Props {
  data: SceneObjectData;
  currentUserId: string;
  projectId: string;
}

interface GLBModelProps {
  url: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/** Load and render a GLB model — falls back to placeholder on error */
function GLBModel({ url }: GLBModelProps) {
  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
  const { scene } = useGLTF(fullUrl);
  // Clone to avoid modifying the cached original
  const cloned = scene.clone(true);
  return <primitive object={cloned} />;
}

/** Error boundary that shows a placeholder if GLB fails to load */
class ErrorBoundarySafe extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <ModelPlaceholder position={[0, 0, 0]} name="⚠ Ошибка" color="#ef4444" />;
    }
    return this.props.children;
  }
}

/**
 * A single placed object in the 3D scene.
 * If object has a modelId with a GLB URL, render the actual model.
 * Otherwise, fall back to a placeholder.
 */
export default function SceneObject({ data, currentUserId, projectId }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const mode = useViewerStore((s) => s.mode);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const selectObject = useViewerStore((s) => s.selectObject);
  const updateObject = useViewerStore((s) => s.updateObject);
  const transformMode = useViewerStore((s) => s.transformMode);
  const showHidden = useViewerStore((s) => s.showHidden);
  const modelUrls = useViewerStore((s) => s.modelUrls);

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

  // Determine which model URL to use (if any)
  const glbUrl = data.modelId ? modelUrls[data.modelId] : undefined;
  const color = data.hidden ? '#f59e0b' : isSelected ? '#10b981' : '#3b82f6';

  return (
    <group
      ref={groupRef}
      position={data.position}
      rotation={data.rotation}
      scale={data.scale}
    >
      {/* Render GLB model or placeholder */}
      {glbUrl ? (
        <Suspense fallback={<ModelPlaceholder position={[0, 0, 0]} name="" color="#94a3b8" />}>
          <ErrorBoundarySafe>
            <GLBModel url={glbUrl} />
          </ErrorBoundarySafe>
        </Suspense>
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
