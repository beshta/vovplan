import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
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
// Максимальный наклон камеры от зенита: ~88° — почти на уровне земли,
// но не «под землю» (раньше было 60°, к земле опуститься было нельзя)
const MAX_POLAR = Math.PI * 0.49;

export default function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const cameraView = useViewerStore((s) => s.cameraView);
  const selectedObjectId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const cameraLocked = useViewerStore((s) => s.cameraLocked);
  const cameraFlyTarget = useViewerStore((s) => s.cameraFlyTarget);
  const clearFlyTarget = useViewerStore((s) => s.clearFlyTarget);
  const setCameraGetter = useViewerStore((s) => s.setCameraGetter);
  const terrainMeta = useViewerStore((s) => s.terrainMeta);
  // Масштаб 1:1: пределы камеры растут вместе с площадкой
  const sceneSize = terrainMeta ? Math.max(terrainMeta.widthM, terrainMeta.heightM) : 200;

  // Регистрируем геттер текущей позы камеры (для сохранения пресетов)
  useEffect(() => {
    setCameraGetter(() => {
      const t = controlsRef.current?.target ?? new THREE.Vector3();
      return {
        position: [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
        target: [t.x, t.y, t.z] as [number, number, number],
      };
    });
    return () => setCameraGetter(null);
  }, [camera, setCameraGetter]);

  // Плавный перелёт к пресету (~0.8с, экспоненциальное приближение)
  useFrame((_, delta) => {
    if (!cameraFlyTarget || !controlsRef.current) return;
    const pos = new THREE.Vector3(...cameraFlyTarget.position);
    const tgt = new THREE.Vector3(...cameraFlyTarget.target);
    const k = 1 - Math.exp(-6 * delta);
    camera.position.lerp(pos, k);
    controlsRef.current.target.lerp(tgt, k);
    controlsRef.current.update();
    if (camera.position.distanceTo(pos) < 0.05 && controlsRef.current.target.distanceTo(tgt) < 0.05) {
      camera.position.copy(pos);
      controlsRef.current.target.copy(tgt);
      controlsRef.current.update();
      clearFlyTarget();
    }
  });

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
      camera.position.set(target.x, target.y + sceneSize * 0.4, target.z + 0.01);
      controlsRef.current.maxPolarAngle = 0;
      controlsRef.current.minPolarAngle = 0;
      controlsRef.current.update();
    } else if (cameraView === 'orbit') {
      // Restore perspective limits (до ~88° — можно опуститься почти к земле)
      controlsRef.current.maxPolarAngle = MAX_POLAR;
      controlsRef.current.minPolarAngle = 0;
      camera.position.set(sceneSize * 0.2, sceneSize * 0.22, sceneSize * 0.2);
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
      minPolarAngle={0}
      maxPolarAngle={cameraView === 'top' ? 0 : MAX_POLAR}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minDistance={2}
      maxDistance={sceneSize * 1.6}
      enablePan
      screenSpacePanning={false}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}
