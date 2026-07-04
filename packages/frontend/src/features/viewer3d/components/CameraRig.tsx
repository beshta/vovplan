import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Camera controller with two modes:
 * 1. Orbit (default) — 45-60° isometric view, limited polar angle
 * 2. First-person — camera at 1.7m height, pointer-lock/joystick look
 */
export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const cameraView = useViewerStore((s) => s.cameraView);

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
