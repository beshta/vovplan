import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { OrbitControls, Grid, Line, Float } from '@react-three/drei';
import { ACESFilmicToneMapping } from 'three';

/**
 * Витрина-сцена для лендинга — самодостаточная, без бэкенда и ассетов.
 * Процедурно показывает суть продукта: площадка (рельеф-сетка) + здания
 * + инженерные сети + метки-аннотации. Крутится мышью (OrbitControls),
 * плюс лёгкое авто-вращение. Фон прозрачный — сцена сливается с тёмным героем.
 */

// Детерминированная «застройка»: [x, z, ширина, глубина, высота, цвет]
const BUILDINGS: [number, number, number, number, number, string][] = [
  [-6, -4, 3, 3, 5, '#3b4763'],
  [-2, -6, 2.4, 2.4, 8, '#4b5a7a'],
  [2, -4, 3.4, 2.6, 4, '#3b4763'],
  [6, -5, 2.2, 2.2, 6.5, '#6366f1'], // акцентное здание (индиго)
  [-7, 2, 2.6, 3.2, 3.5, '#3f4b63'],
  [-2, 1, 3, 3, 6, '#3b4763'],
  [3, 2, 2.4, 3.4, 9, '#22d3ee'], // акцентное здание (циан)
  [7, 1, 2.6, 2.6, 4.5, '#3b4763'],
  [0, 5, 3.6, 2.4, 5.5, '#4b5a7a'],
  [5, 6, 2.2, 2.2, 3, '#3b4763'],
];

// Инженерные сети — неоновые трассы по земле между объектами (ярко на тёмном)
const NETWORKS: { color: string; points: [number, number, number][] }[] = [
  { color: '#22d3ee', points: [[-9, 0.06, -4], [-2, 0.06, -4], [-2, 0.06, 1], [3, 0.06, 1], [3, 0.06, 6]] }, // вода
  { color: '#fbbf24', points: [[-7, 0.06, 3], [0, 0.06, 3], [0, 0.06, -2], [6, 0.06, -2], [8, 0.06, 1]] }, // энергия
  { color: '#4ade80', points: [[-6, 0.06, -6], [6, 0.06, -6], [7, 0.06, 6]] }, // связь
];

// Метки-аннотации (парят над сценой)
const PINS: [number, number, number][] = [
  [-2, 9.5, -6],
  [3, 10.5, 2],
  [6, 8, -5],
];

function Pin({ position }: { position: [number, number, number] }) {
  return (
    <Float speed={2} rotationIntensity={0} floatIntensity={0.6}>
      <group position={position}>
        {/* Ножка-конус, остриём вниз */}
        <mesh rotation={[Math.PI, 0, 0]} position={[0, -0.6, 0]}>
          <coneGeometry args={[0.35, 1.2, 4]} />
          <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={0.6} />
        </mesh>
        {/* Головка */}
        <mesh position={[0, 0.35, 0]}>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshStandardMaterial color="#aab0ff" emissive="#6366f1" emissiveIntensity={0.9} />
        </mesh>
      </group>
    </Float>
  );
}

export default function LandingScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{ alpha: true, antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      camera={{ fov: 45, near: 0.1, far: 200, position: [16, 14, 18] }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        {/* Свет */}
        <hemisphereLight args={['#c7d2fe', '#0b1020', 1.1]} />
        <directionalLight
          position={[12, 20, 8]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />

        {/* Площадка-рельеф: сетка-план + матовое основание для теней */}
        <Grid
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#28304a"
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor="#4f46e5"
          fadeDistance={45}
          fadeStrength={1.5}
          infiniteGrid
          position={[0, 0, 0]}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#0e1424" roughness={1} metalness={0} />
        </mesh>

        {/* Застройка (акцентные — со свечением) */}
        {BUILDINGS.map(([x, z, w, d, h, color], i) => {
          const accent = color === '#6366f1' || color === '#22d3ee';
          return (
            <mesh key={i} position={[x, h / 2, z]} castShadow receiveShadow>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial
                color={color}
                roughness={accent ? 0.35 : 0.7}
                metalness={0.1}
                emissive={accent ? color : '#000000'}
                emissiveIntensity={accent ? 0.35 : 0}
              />
            </mesh>
          );
        })}

        {/* Инженерные сети */}
        {NETWORKS.map((n, i) => (
          <Line key={i} points={n.points} color={n.color} lineWidth={3} />
        ))}

        {/* Метки-аннотации */}
        {PINS.map((p, i) => (
          <Pin key={i} position={p} />
        ))}

        <OrbitControls
          autoRotate
          autoRotateSpeed={0.6}
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 2, 0]}
        />
      </Suspense>
    </Canvas>
  );
}
