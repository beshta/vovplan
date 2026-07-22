import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { fbm, ridged } from '../utils/noise';
import { detectQuality } from '../utils/deviceProfiler';
import { useViewerStore } from '../stores/viewerStore';
import type { TerrainMeta } from '../../../shared/api';

/**
 * DEM-based terrain with vertex displacement.
 *
 * Modes:
 * 1. Real terrain (heightmap + terrainMeta) — импорт с карты: реальные
 *    высоты, пропорции области и спутниковая текстура.
 * 2. Heightmap PNG (ручная загрузка) — яркость = высота, vertex colors.
 * 3. Procedural noise — fBm + ridged, vertex colors.
 */

export interface DemTerrainProps {
  size?: number;
  segments?: number;
  heightmapUrl?: string | null;
  meta?: TerrainMeta | null;
  heightScale?: number;
  seed?: number;
  frequency?: number;
  wireframe?: boolean;
  xray?: boolean;
}

// ── Color stops for vertex coloring (procedural / manual heightmap) ──
const COLOR_STOPS: { h: number; color: THREE.Color }[] = [
  { h: -0.2, color: new THREE.Color('#3a5a40') },
  { h: 0.05, color: new THREE.Color('#5a7a5a') },
  { h: 0.35, color: new THREE.Color('#7a8a5a') },
  { h: 0.6,  color: new THREE.Color('#8a7a6a') },
  { h: 0.85, color: new THREE.Color('#aaaaaa') },
  { h: 1.0,  color: new THREE.Color('#ffffff') },
];

function getTerrainColor(h: number, target: THREE.Color): void {
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

/** Пиксели изображения → ImageData (для сэмплинга высот) */
function imageToData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

export default function DemTerrain(props: DemTerrainProps) {
  if (props.heightmapUrl && props.meta) {
    return <RealTerrain {...props} heightmapUrl={props.heightmapUrl} meta={props.meta} />;
  }
  if (props.heightmapUrl) {
    return <HeightmapTerrain {...props} heightmapUrl={props.heightmapUrl} />;
  }
  return <ProceduralTerrain {...props} />;
}

// ═══ Режим 1: реальный рельеф с текстурой ═══════

function RealTerrain({
  heightmapUrl,
  meta,
  wireframe = false,
  xray = false,
}: DemTerrainProps & { heightmapUrl: string; meta: TerrainMeta }) {
  const basemap = useViewerStore((s) => s.basemap);
  const heightTex = useLoader(THREE.TextureLoader, heightmapUrl);
  // Спутник — только если сервер его сгенерировал; иначе всегда схема
  const surfaceUrl = basemap === 'satellite' && meta.satelliteUrl ? meta.satelliteUrl : meta.textureUrl;
  const surfaceTex = useLoader(THREE.TextureLoader, surfaceUrl);

  useEffect(() => {
    surfaceTex.colorSpace = THREE.SRGBColorSpace;
    surfaceTex.anisotropy = 8;
  }, [surfaceTex]);

  const { geometry } = useMemo(() => {
    // Масштаб 1:1 — один юнит сцены = один метр. Сетка, объекты,
    // вид от первого лица (1.7м) и рельеф в одной честной системе.
    const sizeX = meta.widthM;
    const sizeZ = meta.heightM;
    const heightRange = Math.max(meta.maxElev - meta.minElev, 1);
    const is16bit = meta.encoding === 'rg16';

    const hm = imageToData(heightTex.image as HTMLImageElement);

    // Детализация меша = разрешение DEM (не грубее данных), с потолком по
    // устройству: десктоп до 640², мобильные до 256². Раньше было фикс. 256,
    // что недосэмплило рельеф (~740px DEM → терялась половина деталей).
    const cap = detectQuality().isMobile ? 256 : 640;
    const segments = Math.max(64, Math.min(Math.max(hm.width, hm.height) - 1, cap));

    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Билинейная интерполяция — без «ступенек» между пикселями DEM
      const u = (x / sizeX + 0.5) * (hm.width - 1);
      const v = (z / sizeZ + 0.5) * (hm.height - 1);
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(x0 + 1, hm.width - 1);
      const y1 = Math.min(y0 + 1, hm.height - 1);
      const fx = u - x0;
      const fy = v - y0;

      const sample = (px: number, py: number) => {
        const idx = (py * hm.width + px) * 4;
        return is16bit
          ? (hm.data[idx] * 256 + hm.data[idx + 1]) / 65535
          : hm.data[idx] / 255;
      };

      const top = sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx;
      const bot = sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx;
      const elevation01 = top * (1 - fy) + bot * fy;
      pos.setY(i, elevation01 * heightRange);
    }
    geo.computeVertexNormals();

    return { geometry: geo };
  }, [heightTex, meta]);

  return (
    <mesh geometry={geometry} receiveShadow castShadow={!xray}>
      <meshStandardMaterial
        key={xray ? 'real-xray' : 'real-solid'}
        map={surfaceTex}
        roughness={0.95}
        metalness={0}
        wireframe={wireframe}
        transparent={xray}
        opacity={xray ? 0.25 : 1.0}
        depthWrite={!xray}
      />
    </mesh>
  );
}

// ═══ Режим 2: ручной heightmap (яркость = высота) ═══

function HeightmapTerrain({
  size = 200,
  segments = 128,
  heightmapUrl,
  heightScale = 15,
  wireframe = false,
  xray = false,
}: DemTerrainProps & { heightmapUrl: string }) {
  const heightTex = useLoader(THREE.TextureLoader, heightmapUrl);

  const { geometry } = useMemo(() => {
    const hm = imageToData(heightTex.image as HTMLImageElement);

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const u = (x / size + 0.5) * (hm.width - 1);
      const v = (z / size + 0.5) * (hm.height - 1);
      const idx = (Math.floor(v) * hm.width + Math.floor(u)) * 4;
      const elevation = (hm.data[idx] / 255) * 2 - 1; // [-1, 1]
      pos.setY(i, elevation * heightScale);

      getTerrainColor(elevation * 0.5 + 0.5, color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return { geometry: geo };
  }, [heightTex, size, segments, heightScale]);

  return (
    <mesh geometry={geometry} receiveShadow castShadow={!xray}>
      <meshStandardMaterial
        key={xray ? 'hm-xray' : 'hm-solid'}
        vertexColors
        roughness={0.9}
        metalness={0}
        wireframe={wireframe}
        transparent={xray}
        opacity={xray ? 0.25 : 1.0}
        depthWrite={!xray}
      />
    </mesh>
  );
}

// ═══ Режим 3: процедурный шум ═══════════════════

function ProceduralTerrain({
  size = 200,
  segments = 128,
  heightScale = 15,
  seed = 42,
  frequency = 0.015,
  wireframe = false,
  xray = false,
}: DemTerrainProps) {
  const { geometry } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const nx = (x + seed * 100) * frequency;
      const nz = (z + seed * 100) * frequency;
      const base = fbm(nx, nz, 5, 2.0, 0.5);
      const mountains = ridged(nx * 0.5, nz * 0.5, 4, 2.0, 0.5);
      const elevation = base * 0.7 + mountains * 0.3;
      pos.setY(i, elevation * heightScale);

      getTerrainColor(elevation * 0.5 + 0.5, color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return { geometry: geo };
  }, [size, segments, heightScale, seed, frequency]);

  return (
    <mesh geometry={geometry} receiveShadow castShadow={!xray}>
      <meshStandardMaterial
        key={xray ? 'proc-xray' : 'proc-solid'}
        vertexColors
        roughness={0.9}
        metalness={0}
        wireframe={wireframe}
        transparent={xray}
        opacity={xray ? 0.25 : 1.0}
        depthWrite={!xray}
      />
    </mesh>
  );
}
