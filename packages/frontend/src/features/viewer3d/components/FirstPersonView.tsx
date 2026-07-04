import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';

const EYE_HEIGHT = 1.7;

/**
 * First-person camera mode.
 * When activated: camera drops to ground level at a clicked point,
 * oriented toward the nearest object.
 *
 * This component renders nothing visually — it controls the camera.
 * It must be placed inside <Canvas>.
 */
export default function FirstPersonView({ targetPoint }: { targetPoint: [number, number, number] | null }) {
  const { camera } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const targetPos = useRef(new THREE.Vector3());
  const progress = useRef(0);
  const isAnimating = useRef(false);

  const cameraView = useViewerStore((s) => s.cameraView);

  // ── Start animation when target point changes ──
  useEffect(() => {
    if (!targetPoint || cameraView !== 'first-person') return;

    startPos.current.copy(camera.position);
    targetPos.current.set(targetPoint[0], EYE_HEIGHT, targetPoint[2]);
    progress.current = 0;
    isAnimating.current = true;
  }, [targetPoint, cameraView]);

  // ── Animate camera descent ──
  useFrame((_, delta) => {
    if (!isAnimating.current) return;

    progress.current = Math.min(progress.current + delta * 1.2, 1);
    const t = easeInOutCubic(progress.current);
    camera.position.lerpVectors(startPos.current, targetPos.current, t);

    if (progress.current >= 1) {
      isAnimating.current = false;
    }
  });

  return null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
