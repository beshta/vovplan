import Terrain from './Terrain';
import DemTerrain from './DemTerrain';

/**
 * Terrain manager — picks the right terrain renderer based on available data.
 *
 * Priority:
 * 1. heightmapUrl и процедурный выключен → DemTerrain с реальными высотами
 * 2. procedural=true → DemTerrain с процедурным fBm-шумом
 * 3. иначе → плоский Terrain
 *
 * Важно: процедурный режим лишь перекрывает загруженный рельеф, но не стирает
 * его — выключив тумблер, пользователь возвращается к импортированной карте.
 *
 * The Scene component passes terrainUrl (from project API) + procedural flag
 * (from viewerStore) here.
 */
import type { TerrainMeta } from '../../../shared/api';

export interface TerrainManagerProps {
  size?: number;
  /** Real DEM PNG URL from backend (project.terrainUrl) */
  heightmapUrl?: string | null;
  /** Метаданные импортированного реального рельефа (текстура, размеры, высоты) */
  meta?: TerrainMeta | null;
  /** If true and no heightmap → use procedural noise terrain */
  procedural?: boolean;
  /** X-Ray transparency */
  xray?: boolean;
}

export default function TerrainManager({
  size = 200,
  heightmapUrl = null,
  meta = null,
  procedural = true,
  xray = false,
}: TerrainManagerProps) {
  // Mode 1: Real heightmap PNG from backend (+meta = реальный рельеф с текстурой)
  if (heightmapUrl && !procedural) {
    return <DemTerrain size={size} heightmapUrl={heightmapUrl} meta={meta} xray={xray} />;
  }

  // Mode 2: Procedural noise terrain
  if (procedural) {
    return <DemTerrain size={size} xray={xray} />;
  }

  // Mode 3: Flat fallback (old Terrain)
  return <Terrain size={size} xray={xray} />;
}
