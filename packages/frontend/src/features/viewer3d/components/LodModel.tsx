import { Suspense, Component, useMemo } from 'react';
import * as THREE from 'three';
import type { ReactNode } from 'react';
import { useGLTF, Detailed } from '@react-three/drei';
import ModelPlaceholder from './ModelPlaceholder';
import { collapseInstances } from '../utils/instancing';
import { API_URL } from '../../../shared/api';
import { assetUrl } from '../../../shared/assetUrl';

interface LodModelProps {
  /** Primary GLB URL (highest detail, always present) */
  glbUrl: string;
  /** LOD1 — medium detail, shown at medium distance */
  lod1Url?: string | null;
  /** LOD2 — low detail, shown at far distance */
  lod2Url?: string | null;
  /** Fallback name for placeholder */
  name: string;
}

/**
 * Загружает GLB и готовит его к показу.
 *
 * Повторы схлопываются в аппаратные копии сразу после клонирования: чертёж на
 * пятнадцать тысяч деталей иначе даёт столько же вызовов отрисовки, и сцена
 * идёт двадцатью кадрами в секунду при вполне скромных двух миллионах
 * треугольников.
 *
 * Результат запоминается по ссылке на файл: клонирование и перебор узлов —
 * работа не бесплатная, а один и тот же GLB стоит в сцене помногу раз.
 */
const prepared = new Map<string, THREE.Object3D>();

function prepare(url: string, scene: THREE.Object3D): THREE.Object3D {
  const cached = prepared.get(url);
  if (cached) return cached;
  const template = scene.clone(true);
  collapseInstances(template);
  prepared.set(url, template);
  return template;
}

function GlbScene({ url }: { url: string }) {
  const { scene } = useGLTF(assetUrl(url, API_URL));

  // Отдавать наружу саму заготовку нельзя: у объекта three.js один родитель,
  // и вторая сцена с той же моделью просто отняла бы её у первой. Клонируем —
  // геометрия и материалы при этом остаются общими, копируются только узлы,
  // а их после схлопывания сотни, а не десятки тысяч.
  const object = useMemo(() => prepare(url, scene).clone(true), [scene, url]);

  return <primitive object={object} />;
}

/** Error boundary → red placeholder */
class ErrorBoundarySafe extends Component<{ children: ReactNode; name: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <ModelPlaceholder position={[0, 0, 0]} name={this.props.name} color="#ef4444" />;
    }
    return this.props.children;
  }
}

/**
 * LOD Model — 3 levels of detail with automatic distance-based switching.
 *
 * Level 0 (LOD0): glbUrl        — full detail, shown when close (< 30m)
 * Level 1 (LOD1): lod1Url      — medium detail, shown at mid range (30–80m)
 * Level 2 (LOD2): lod2Url      — low detail, shown far away (> 80m)
 *
 * If LOD1/LOD2 are missing, falls back to LOD0 at all distances.
 * If no GLB at all, shows a colored placeholder.
 *
 * Uses three.js LOD (Level-of-Detail) via drei <Detailed> — the renderer
 * automatically picks the right mesh each frame based on camera distance,
 * dramatically reducing draw calls on large scenes.
 */
export default function LodModel({ glbUrl, lod1Url, lod2Url, name }: LodModelProps) {
  // Пороги переключения: distance[i] — с какого расстояния показывать
  // соответствующего ребёнка
  const distances: [number, number, number] = [0, 30, 80];
  const hasLods = !!lod1Url || !!lod2Url;

  return (
    <ErrorBoundarySafe name={name}>
      <Suspense fallback={<ModelPlaceholder position={[0, 0, 0]} name="" color="#94a3b8" />}>
        {hasLods ? (
          <Detailed distances={distances}>
            <GlbScene url={glbUrl} />
            <GlbScene url={lod1Url ?? glbUrl} />
            <GlbScene url={lod2Url ?? glbUrl} />
          </Detailed>
        ) : (
          // Упрощённых уровней нет — показываем модель как есть. Раньше здесь
          // всё равно стоял переключатель с тремя одинаковыми копиями: разницы
          // на экране ноль, а сцена и память несли её втройне.
          <GlbScene url={glbUrl} />
        )}
      </Suspense>
    </ErrorBoundarySafe>
  );
}
