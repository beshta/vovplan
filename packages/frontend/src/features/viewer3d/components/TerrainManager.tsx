import Terrain from './Terrain';
import DemTerrain from './DemTerrain';

/**
 * Terrain manager — picks the right terrain renderer based on available data.
 *
 * Priority:
 * 1. heightmapUrl (uploaded DEM PNG) → DemTerrain with real elevation data
 * 2. procedural=true (no PNG yet) → DemTerrain with procedural fBm noise
 * 3. procedural=false (flat fallback) → old flat Terrain
 *
 * The Scene component passes terrainUrl (from project API) + procedural flag
 * (from viewerStore) here.
 */
export interface TerrainManagerProps {
  size?: number;
  /** Real DEM PNG URL from backend (project.terrainUrl) */
  heightmapUrl?: string | null;
  /** If true and no heightmap → use procedural noise terrain */
  procedural?: boolean;
  /** X-Ray transparency */
  xray?: boolean;
}

export default function TerrainManager({
  size = 200,
  heightmapUrl = null,
  procedural = true,
  xray = false,
}: TerrainManagerProps) {
  // Mode 1: Real heightmap PNG from backend
  if (heightmapUrl) {
    return <DemTerrain size={size} heightmapUrl={heightmapUrl} xray={xray} />;
  }

  // Mode 2: Procedural noise terrain
  if (procedural) {
    return <DemTerrain size={size} xray={xray} />;
  }

  // Mode 3: Flat fallback (old Terrain)
  return <Terrain size={size} xray={xray} />;
}
