import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useViewerStore } from '../stores/viewerStore';
import type { TerrainMeta } from '../../../shared/api';

interface BuildingBox {
  p: [number, number][]; // контур, локальные метры (x — восток, z — юг)
  h: number;             // высота, м
  base: number;          // высота основания над minElev, м
}

/**
 * Здания из OSM — экструзия контуров на реальную высоту (height /
 * building:levels × 3м / дефолт 9м), посаженная на рельеф.
 * Вся застройка мерджится в одну геометрию — тысячи зданий за один draw call.
 */
export default function BuildingsLayer({ meta }: { meta: TerrainMeta }) {
  const xray = useViewerStore((s) => s.xrayMode);
  const showBuildings = useViewerStore((s) => s.showBuildings);
  const [buildings, setBuildings] = useState<BuildingBox[] | null>(null);

  useEffect(() => {
    if (!meta.buildingsUrl) return;
    let cancelled = false;
    fetch(meta.buildingsUrl)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setBuildings(json.buildings ?? []);
      })
      .catch(() => setBuildings([]));
    return () => {
      cancelled = true;
    };
  }, [meta.buildingsUrl]);

  const geometry = useMemo(() => {
    if (!buildings || buildings.length === 0) return null;

    const parts: THREE.BufferGeometry[] = [];
    for (const b of buildings) {
      if (b.p.length < 3) continue;
      // Shape в плоскости XY; y = -z, чтобы после rotateX(-90°) знак Z сошёлся
      const shape = new THREE.Shape();
      shape.moveTo(b.p[0][0], -b.p[0][1]);
      for (let i = 1; i < b.p.length; i++) {
        shape.lineTo(b.p[i][0], -b.p[i][1]);
      }
      shape.closePath();

      try {
        const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        // Заглубляем на 1.5м — чтобы на склонах не было щелей под стенами
        geo.translate(0, b.base - 1.5, 0);
        parts.push(geo);
      } catch {
        // редкие самопересекающиеся контуры OSM — пропускаем
      }
    }
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
  }, [buildings]);

  if (!geometry || !showBuildings) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        key={xray ? 'bld-xray' : 'bld-solid'}
        color="#dcd8cf"
        roughness={0.85}
        metalness={0}
        transparent={xray}
        opacity={xray ? 0.15 : 1.0}
        depthWrite={!xray}
      />
    </mesh>
  );
}
