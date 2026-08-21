import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
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

/**
 * На сколько метров вперёд ставится точка взгляда, когда орбиты нет.
 *
 * Пятнадцать — это уже «даль» для человека на площадке: вид, сохранённый от
 * первого лица, вернётся тем же кадром, а не носом в ближайшую стену.
 */
const GAZE_DISTANCE = 15;

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

  /*
   * Геттер текущей позы камеры — им сохраняются виды.
   *
   * В режиме от первого лица орбиты нет, а с ней нет и точки, вокруг которой
   * она вращается. Раньше в этом случае в пресет уходил ноль координат, то
   * есть центр площадки: сохранённый вид смотрел куда угодно, только не туда,
   * куда смотрел человек. Поэтому без орбиты цель берётся прямо по взгляду.
   */
  useEffect(() => {
    setCameraGetter(() => {
      const position: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const controls = controlsRef.current;
      if (controls) {
        const t = controls.target;
        return { position, target: [t.x, t.y, t.z] as [number, number, number] };
      }
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const ahead = camera.position.clone().addScaledVector(dir, GAZE_DISTANCE);
      return { position, target: [ahead.x, ahead.y, ahead.z] as [number, number, number] };
    });
    return () => setCameraGetter(null);
  }, [camera, setCameraGetter]);

  // Плавный перелёт к пресету (~0.8с, экспоненциальное приближение)
  const flyElapsed = useRef(0);
  useEffect(() => {
    flyElapsed.current = 0;
  }, [cameraFlyTarget]);

  useFrame((_, delta) => {
    if (!cameraFlyTarget) return;
    /*
     * Без OrbitControls лететь нечем: в режиме от первого лица их нет вовсе,
     * и на время загрузки сцены (Suspense) тоже. Раньше здесь стоял тихий
     * выход — вместе с ним не шёл и отсчёт времени ниже, поэтому цель перелёта
     * переживала смену режима. По возвращении в обзор она каждый кадр тянула
     * камеру в одну и ту же позу, и повернуть её было нельзя.
     */
    if (!controlsRef.current) {
      clearFlyTarget();
      return;
    }
    const pos = new THREE.Vector3(...cameraFlyTarget.position);
    const tgt = new THREE.Vector3(...cameraFlyTarget.target);
    const k = 1 - Math.exp(-6 * delta);
    camera.position.lerp(pos, k);
    controlsRef.current.target.lerp(tgt, k);
    controlsRef.current.update();

    const arrived =
      camera.position.distanceTo(pos) < 0.05 && controlsRef.current.target.distanceTo(tgt) < 0.05;
    // Ограничение по времени обязательно: если поза недостижима (упирается в
    // предел угла или дистанции), OrbitControls каждый кадр возвращает камеру
    // назад, сближение не наступает никогда — и камера навсегда залипает,
    // перебивая вращение мышью.
    flyElapsed.current += delta;
    if (arrived || flyElapsed.current > 2) {
      if (arrived) {
        camera.position.copy(pos);
        controlsRef.current.target.copy(tgt);
        controlsRef.current.update();
      }
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
  const prevView = useRef(cameraView);
  useEffect(() => {
    if (!controlsRef.current) return;
    const switched = prevView.current !== cameraView;
    prevView.current = cameraView;

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
      /*
       * Позу сбрасываем только при входе в обзор из другого режима.
       * Иначе смена объекта камеры (R3F пересобирает её, когда меняется
       * `far` вместе с размером площадки) каждый раз ставит камеру в одну
       * точку, а незавершённый перелёт в это же время тянет в другую —
       * со стороны это бесконечное приближение.
       */
      if (switched) {
        camera.position.set(sceneSize * 0.2, sceneSize * 0.22, sceneSize * 0.2);
        controlsRef.current.target.set(0, 0, 0);
      }
      controlsRef.current.update();
    }
  }, [cameraView, camera, sceneSize]);

  // В first-person камерой управляет FirstPersonView (drag-look мышью + WASD).
  // Никаких OrbitControls/PointerLock здесь — иначе они перехватывают ввод.
  if (cameraView === 'first-person') {
    return null;
  }

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!cameraLocked}
      /*
       * Взялись за камеру — перелёт отменяется.
       *
       * Обзорный перелёт запускается при загрузке рельефа и длится до двух
       * секунд. Всё это время он каждый кадр подтягивал камеру к своей позе:
       * повернуть удавалось градусов на двадцать, дальше будто мягкая стена
       * откидывала назад, и отпускало только по истечении срока. Событие
       * `start` OrbitControls шлёт лишь на настоящий ввод — колесо, перетаскивание,
       * касание, — а на наши update() изнутри кадра не шлёт, так что перелёт,
       * которого никто не трогает, доигрывает как прежде.
       */
      onStart={clearFlyTarget}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0}
      maxPolarAngle={cameraView === 'top' ? 0 : MAX_POLAR}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minDistance={2}
      // Отдалиться можно сильно дальше площадки: прежний предел 1.6× упирался
      // в край сцены и мешал осмотреть её целиком
      maxDistance={sceneSize * 8}
      enablePan
      screenSpacePanning={false}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}
