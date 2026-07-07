import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useViewerStore } from '../stores/viewerStore';
import * as THREE from 'three';

/**
 * Camera controller with three modes:
 * 1. Orbit (perspective) — 45-60° isometric view
 * 2. Top — straight down, 90°
 * 3. First-person — camera at 1.7m height, pointer-lock
 *
 * When an object is selected, the orbit target moves to that object
 * so rotation orbits around it. BUT only once on selection —
 * the camera does NOT follow during transform (stays put).
 *
 * When a transform is active (dragging), orbit controls are disabled.
 */
export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const cameraView = useViewerStore((s) => s.cameraView);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const cameraLocked = useViewerStore((s) => s.cameraLocked);

  // Move orbit target to selected object — ONLY on selection change, not during transform
  useEffect(() => {
    if (!controlsRef.current || cameraView === 'first-person') return;
    if (!selectedObjectId) return;
    const obj = objects.find((o) => o.id === selectedObjectId);
    if (!obj) return;
    const target = new THREE.Vector3(obj.position[0], obj.position[1] + 1, obj.position[2]);
    controlsRef.current.target.lerp(target, 0.5);
    controlsRef.current.update();
  }, [selectedObjectId, cameraView]); // NOT objects — so camera doesn't follow during drag

  // Switch camera position for top view vs orbit
  useEffect(() => {
    if (!controlsRef.current) return;
    if (cameraView === 'top') {
      // Straight down — look at center of scene
      const target = controlsRef.current.target.clone();
      camera.position.set(target.x, target.y + 80, target.z + 0.01);
      controlsRef.current.maxPolarAngle = 0;
      controlsRef.current.minPolarAngle = 0;
      controlsRef.current.update();
    } else if (cameraView === 'orbit') {
      // Restore perspective limits
      controlsRef.current.maxPolarAngle = Math.PI / 3;
      controlsRef.current.minPolarAngle = Math.PI / 6;
      camera.position.set(40, 45, 40);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
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
      minPolarAngle={cameraView === 'top' ? 0 : Math.PI / 6}
      maxPolarAngle={cameraView === 'top' ? 0 : Math.PI / 3}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minDistance={5}
      maxDistance={200}
      enablePan
      screenSpacePanning={false}
    />
  );
}
