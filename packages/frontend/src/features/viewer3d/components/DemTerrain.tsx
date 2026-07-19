import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { fbm, ridged } from '../utils/noise';

/**
 * DEM-based terrain with vertex displacement.
 *
 * Three modes:
 * 1. Heightmap PNG (from backend terrainUrl) — real elevation data
 * 2. Procedural noise — fBm + ridged for natural-looking hills
 * 3. Flat — fallback (same as old Terrain.tsx)
 *
 * Features:
 * - Vertex colors based on elevation (water → grass → rock → snow)
 * - Wireframe option for debugging
 * - Adjustable height scale & noise parameters
 * - X-Ray: terrain becomes semi-transparent (for underground utilities)
 */

export interface DemTerrainProps {
  size?: number;
  segments?: number;
  /** Heightmap texture URL (PNG). If null → procedural noise */
  heightmapUrl?: string | null;
  /** Max elevation in scene units (default 15) */
  heightScale?: number;
  /** Procedural seed (only used when no heightmap) */
  seed?: number;
  /** Noise frequency — lower = larger features (default 0.015) */
  frequency?: number;
  /** Wireframe mode */
  wireframe?: boolean;
  /** X-Ray transparency (utilities view) */
  xray?: boolean;
  /** Lighting callback when terrain height at origin changes */
  onTerrainReady?: (maxHeight: number) => void;
}

// ── Color stops for vertex coloring ──
const COLOR_STOPS: { h: number; color: THREE.Color }[] = [
  { h: -0.2, color: new THREE.Color('#3a5a40') },  // swamp / dark grass
  { h: 0.05, color: new THREE.Color('#5a7a5a') },  // grass green
  { h: 0.35, color: new THREE.Color('#7a8a5a') },  // dry grass / dirt
  { h: 0.6,  color: new THREE.Color('#8a7a6a') },  // rock
  { h: 0.85, color: new THREE.Color('#aaaaaa') },  // light rock
  { h: 1.0,  color: new THREE.Color('#ffffff') },   // snow
];

function getTerrainColor(h: number, target: THREE.Color): void {
  // h is normalized 0..1
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (h >= a.h && h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      target.copy(a.color).lerp(b.color, t);
      return;
    }
  }
  target.copy(COLOR_STOPS[COLOR_STOPS.length - 1].color);
}

export default function DemTerrain({
  size = 200,
  segments = 128,
  heightmapUrl = null,
  heightScale = 15,
  seed = 42,
  frequency = 0.015,
  wireframe = false,
  xray = false,
  onTerrainReady,
}: DemTerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // ── Load heightmap PNG if provided ──
  const heightmapTexture = useMemo(() => {
    if (!heightmapUrl) return null;
    const loader = new THREE.TextureLoader();
    return loader.load(heightmapUrl);
  }, [heightmapUrl]);

  // ── Get heightmap pixel data ──
  const heightmapData = useMemo(() => {
    if (!heightmapTexture) return null;

    const img = heightmapTexture.image;
    if (!img) return null;

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  }, [heightmapTexture]);

  // ── Build geometry with vertex displacement ──
  const { geometry, maxHeight } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    let maxH = 0;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      let elevation: number;

      if (heightmapData) {
        // Sample heightmap PNG
        const hw = heightmapData.width;
        const hh = heightmapData.height;
        // Map x,z to texture coords [-1,1] → [0,1]
        const u = (x / size + 0.5) * (hw - 1);
        const v = (z / size + 0.5) * (hh - 1);
        const idx = (Math.floor(v) * hw + Math.floor(u)) * 4;
        // Red channel as grayscale elevation [0,1]
        elevation = (heightmapData.data[idx] / 255) * 2 - 1; // [-1, 1]
      } else {
        // Procedural noise: fBm base + ridged mountains
        const nx = (x + seed * 100) * frequency;
        const nz = (z + seed * 100) * frequency;

        const base = fbm(nx, nz, 5, 2.0, 0.5);
        const mountains = ridged(nx * 0.5, nz * 0.5, 4, 2.0, 0.5);
        // Blend: 70% rolling hills + 30% ridged mountains
        elevation = base * 0.7 + mountains * 0.3;
      }

      // Apply height scale
      const h = elevation * heightScale;
      pos.setY(i, h);

      if (Math.abs(h) > maxH) maxH = Math.abs(h);

      // Vertex color based on normalized elevation
      const normalizedH = elevation * 0.5 + 0.5; // [0, 1]
      const color = new THREE.Color();
      getTerrainColor(normalizedH, color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    return { geometry: geo, maxHeight: maxH };
  }, [size, segments, heightmapData, heightScale, seed, frequency]);

  // Notify parent when terrain is ready
  useEffect(() => {
    onTerrainReady?.(maxHeight);
  }, [maxHeight, onTerrainReady]);

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow={!xray}>
      {/* key форсирует пересоздание материала при переключении X-ray:
          переключение transparent на живом материале three.js применяет
          недетерминированно (нужна перекомпиляция шейдера) — из-за этого
          прозрачность «то есть, то нет» */}
      <meshStandardMaterial
        key={xray ? 'terrain-xray' : 'terrain-solid'}
        vertexColors
        roughness={0.9}
        metalness={0}
        flatShading={false}
        wireframe={wireframe}
        transparent={xray}
        opacity={xray ? 0.25 : 1.0}
        depthWrite={!xray}
      />
    </mesh>
  );
}
