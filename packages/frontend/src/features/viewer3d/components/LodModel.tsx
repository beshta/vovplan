import { Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { useGLTF, Detailed } from '@react-three/drei';
import ModelPlaceholder from './ModelPlaceholder';

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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function toAbsolute(url: string): string {
  return url.startsWith('http') ? url : `${API_URL}${url}`;
}

/** Load a GLB scene object from a URL */
function GlbScene({ url }: { url: string }) {
  const { scene } = useGLTF(toAbsolute(url));
  const cloned = scene.clone(true);
  return <primitive object={cloned} />;
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
  // Build the LOD distance thresholds.
  // <Detailed distances> define where each level starts (from high → low).
  // drei renders children in order; distance[i] = "switch to this child at this distance".
  const distances: [number, number, number] = [0, 30, 80];

  // Determine which LOD URLs are actually available
  const hasLod1 = !!lod1Url;
  const hasLod2 = !!lod2Url;

  return (
    <ErrorBoundarySafe name={name}>
      <Suspense fallback={<ModelPlaceholder position={[0, 0, 0]} name="" color="#94a3b8" />}>
        <Detailed distances={distances}>
          {/* LOD0 — full quality */}
          <GlbScene url={glbUrl} />
          {/* LOD1 — medium (or reuse LOD0 if not provided) */}
          {hasLod1 ? <GlbScene url={lod1Url!} /> : <GlbScene url={glbUrl} />}
          {/* LOD2 — low (or reuse LOD0 if not provided) */}
          {hasLod2 ? <GlbScene url={lod2Url!} /> : <GlbScene url={glbUrl} />}
        </Detailed>
      </Suspense>
    </ErrorBoundarySafe>
  );
}
