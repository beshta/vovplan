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
  const startGaze = useRef(new THREE.Vector3());
  const endGaze = useRef(new THREE.Vector3());
  const progress = useRef(0);
  const isAnimating = useRef(false);

  const cameraView = useViewerStore((s) => s.cameraView);

  // ── Start animation when target point changes ──
  useEffect(() => {
    if (!targetPoint || cameraView !== 'first-person') return;

    startPos.current.copy(camera.position);
    // Высота глаз считается от уровня земли в точке клика
    targetPos.current.set(targetPoint[0], targetPoint[1] + EYE_HEIGHT, targetPoint[2]);

    // Взгляд: из текущего направления → к горизонту в сторону центра сцены
    // (иначе камера сохраняет орбитальный наклон и после спуска смотрит в землю)
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    startGaze.current.copy(camera.position).addScaledVector(dir, 30);

    const horiz = new THREE.Vector3(-targetPoint[0], 0, -targetPoint[2]);
    if (horiz.lengthSq() < 1) horiz.set(0, 0, -1); // высадка у центра — смотрим на север
    horiz.normalize();
    endGaze.current.copy(targetPos.current).addScaledVector(horiz, 30);

    progress.current = 0;
    isAnimating.current = true;
  }, [targetPoint, cameraView]);

  // ── WASD-движение (после спуска) ──
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ── Animate camera descent + walking ──
  useFrame((_, delta) => {
    if (isAnimating.current) {
      progress.current = Math.min(progress.current + delta * 1.2, 1);
      const t = easeInOutCubic(progress.current);
      camera.position.lerpVectors(startPos.current, targetPos.current, t);
      // Плавно поднимаем взгляд к горизонту
      const gaze = new THREE.Vector3().lerpVectors(startGaze.current, endGaze.current, t);
      camera.lookAt(gaze);

      if (progress.current >= 1) {
        isAnimating.current = false;
      }
      return;
    }

    if (!targetPoint || cameraView !== 'first-person') return;

    // Ходьба: WASD/стрелки в горизонтальной плоскости, высота глаз фиксирована
    const k = keys.current;
    const forward = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    const strafe = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    if (forward === 0 && strafe === 0) return;

    const speed = 8 * delta; // м/с
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).negate();

    camera.position.addScaledVector(dir, forward * speed);
    camera.position.addScaledVector(side, -strafe * speed);
    camera.position.y = EYE_HEIGHT + targetPoint[1]; // остаёмся на высоте глаз
  });

  return null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
