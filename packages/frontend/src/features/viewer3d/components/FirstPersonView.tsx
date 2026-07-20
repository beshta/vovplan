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
  const { camera, gl } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const targetPos = useRef(new THREE.Vector3());
  const startGaze = useRef(new THREE.Vector3());
  const endGaze = useRef(new THREE.Vector3());
  const progress = useRef(0);
  const isAnimating = useRef(false);

  // Углы взгляда: yaw (поворот вокруг вертикали) + pitch (наклон). Управляются мышью.
  const yaw = useRef(0);
  const pitch = useRef(0);

  const cameraView = useViewerStore((s) => s.cameraView);

  // ── Start animation when target point changes ──
  useEffect(() => {
    if (!targetPoint || cameraView !== 'first-person') return;

    startPos.current.copy(camera.position);
    // Высота глаз считается от уровня земли в точке клика
    targetPos.current.set(targetPoint[0], targetPoint[1] + EYE_HEIGHT, targetPoint[2]);

    // Взгляд: из текущего направления → к горизонту в сторону центра сцены
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    startGaze.current.copy(camera.position).addScaledVector(dir, 30);

    const horiz = new THREE.Vector3(-targetPoint[0], 0, -targetPoint[2]);
    if (horiz.lengthSq() < 1) horiz.set(0, 0, -1); // высадка у центра — смотрим на север
    horiz.normalize();
    endGaze.current.copy(targetPos.current).addScaledVector(horiz, 30);

    // Инициализируем углы из финального направления взгляда, чтобы drag-look
    // продолжил с той стороны, куда камера смотрит после спуска
    yaw.current = Math.atan2(-horiz.x, -horiz.z);
    pitch.current = 0;

    progress.current = 0;
    isAnimating.current = true;
  }, [targetPoint, cameraView]);

  // ── Вращение взгляда зажатой мышью (drag-to-look) ──
  // Надёжнее PointerLock: не требует захвата курсора, работает в iframe/песочнице.
  useEffect(() => {
    if (cameraView !== 'first-person') return;
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const SENS = 0.0025; // чувствительность (рад/пиксель)
    const PITCH_LIMIT = Math.PI / 2 - 0.05;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || isAnimating.current) return;
      yaw.current -= (e.clientX - lastX) * SENS;
      pitch.current -= (e.clientY - lastY) * SENS;
      pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => { dragging = false; el.style.cursor = 'grab'; };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [cameraView, gl]);

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

  // ── Animate camera descent + walking + look ──
  useFrame((_, delta) => {
    if (isAnimating.current) {
      progress.current = Math.min(progress.current + delta * 1.2, 1);
      const t = easeInOutCubic(progress.current);
      camera.position.lerpVectors(startPos.current, targetPos.current, t);
      const gaze = new THREE.Vector3().lerpVectors(startGaze.current, endGaze.current, t);
      camera.lookAt(gaze);

      if (progress.current >= 1) isAnimating.current = false;
      return;
    }

    if (!targetPoint || cameraView !== 'first-person') return;

    // Направление взгляда из yaw/pitch (мышь)
    const dir = new THREE.Vector3(
      Math.sin(yaw.current) * Math.cos(pitch.current),
      Math.sin(pitch.current),
      Math.cos(yaw.current) * Math.cos(pitch.current),
    );
    camera.lookAt(camera.position.clone().add(dir));

    // Ходьба: WASD/стрелки в горизонтальной плоскости, высота глаз фиксирована
    const k = keys.current;
    const forward = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    const strafe = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    if (forward === 0 && strafe === 0) return;

    const speed = 8 * delta; // м/с
    const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const side = new THREE.Vector3().crossVectors(flatDir, new THREE.Vector3(0, 1, 0)).negate();

    camera.position.addScaledVector(flatDir, forward * speed);
    camera.position.addScaledVector(side, -strafe * speed);
    camera.position.y = EYE_HEIGHT + targetPoint[1]; // остаёмся на высоте глаз
  });

  return null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
