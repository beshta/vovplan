import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useViewerStore } from '../stores/viewerStore';
import * as THREE from 'three';

/**
 * Camera controller with two modes:
 * 1. Orbit (default) — 45-60° isometric view, limited polar angle
 * 2. First-person — camera at 1.7m height, pointer-lock
 *
 * When an object is selected, the orbit target moves to that object
 * so rotation orbits around it.
 *
 * When a transform is active (dragging), orbit controls are disabled
 * to prevent camera jitter.
 */
export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const cameraView = useViewerStore((s) => s.cameraView);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const cameraLocked = useViewerStore((s) => s.cameraLocked);

  // Move orbit target to selected object
  useEffect(() => {
    if (!controlsRef.current || cameraView !== 'orbit') return;
    if (!selectedObjectId) return;
    const obj = objects.find((o) => o.id === selectedObjectId);
    if (!obj) return;
    const target = new THREE.Vector3(obj.position[0], obj.position[1] + 1, obj.position[2]);
    controlsRef.current.target.lerp(target, 0.5);
    controlsRef.current.update();
  }, [selectedObjectId, objects, cameraView]);

  // Initial camera position
  useEffect(() => {
    if (cameraView === 'orbit') {
      camera.position.set(40, 45, 40);
      camera.lookAt(0, 0, 0);
    }
  }, [cameraView, camera]);

  if (cameraView === 'first-person') {
    return <PointerLockControls />;
  }

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!cameraLocked}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 3}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minDistance={5}
      maxDistance={200}
      enablePan
      screenSpacePanning={false}
    />
  );
}
