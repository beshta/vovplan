import { useRef, useState } from 'react';
import { Mountain, Upload, Trash2, Dices, Grid3x3, Globe, Building2, Trees } from 'lucide-react';
import MapImportModal from './MapImportModal';
import { useViewerStore } from '../stores/viewerStore';
import { terrainApi } from '../../../shared/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Terrain control panel — upload DEM heightmap, toggle procedural/flat/wireframe.
 *
 * Collapsible panel, floats in the top-right area below the toolbar.
 * Only visible for editors (MASTER, DESIGNER).
 */
export default function TerrainPanel({ projectId, centerLat, centerLng }: { projectId: string; centerLat?: number; centerLng?: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const mapOpen = useViewerStore((s) => s.mapImportOpen);
  const setMapOpen = useViewerStore((s) => s.setMapImportOpen);

  const terrainUrl = useViewerStore((s) => s.terrainUrl);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const basemap = useViewerStore((s) => s.basemap);
  const setBasemap = useViewerStore((s) => s.setBasemap);
  const proceduralTerrain = useViewerStore((s) => s.proceduralTerrain);
  const setProceduralTerrain = useViewerStore((s) => s.setProceduralTerrain);
  const wireframe = useViewerStore((s) => s.wireframe);
  const terrainMeta = useViewerStore((s) => s.terrainMeta);
  const showBuildings = useViewerStore((s) => s.showBuildings);
  const setShowBuildings = useViewerStore((s) => s.setShowBuildings);
  const showNature = useViewerStore((s) => s.showNature);
  const setShowNature = useViewerStore((s) => s.setShowNature);
  const setWireframe = useViewerStore((s) => s.setWireframe);
  const setTerrainMeta = useViewerStore((s) => s.setTerrainMeta);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const result = await terrainApi.upload(projectId, file);
      setTerrainUrl(result.terrainUrl);
      setProceduralTerrain(false);
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemoveTerrain = async () => {
    try {
      await terrainApi.remove(projectId);
      setTerrainUrl(null);
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="glass pointer-events-auto w-52 shrink-0">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3.5 py-2.5"
      >
        <span className="hud-title flex items-center gap-1.5"><Mountain size={14} /> Ландшафт</span>
        <span className="text-slate-500 dark:text-slate-400 text-xs">{collapsed ? '▾' : '▴'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/10 pt-2.5">
          {/* Current mode badge */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Режим:</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-900/5 text-slate-600 dark:bg-white/10 dark:text-slate-300 font-medium">
              {proceduralTerrain ? 'Процедурный' : terrainUrl ? 'Карта (DEM)' : 'Плоский'}
            </span>
          </div>

          {/* Переключатель подложки для реального ландшафта: схема / спутник */}
          {terrainMeta && (
            <div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Подложка</span>
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => setBasemap('scheme')}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    basemap === 'scheme' ? 'bg-vovplan-600 text-white' : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
                  }`}
                >
                  Схема
                </button>
                <button
                  onClick={() => terrainMeta.satelliteUrl && setBasemap('satellite')}
                  disabled={!terrainMeta.satelliteUrl}
                  title={terrainMeta.satelliteUrl ? 'Спутниковый снимок' : 'Спутник недоступен для этой площадки'}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                    basemap === 'satellite' ? 'bg-vovplan-600 text-white' : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
                  }`}
                >
                  Спутник
                </button>
              </div>
            </div>
          )}

          {/* Импорт реального ландшафта с карты */}
          <button
            onClick={() => setMapOpen(true)}
            className="btn-primary w-full text-xs py-2"
          >
            <span className="flex items-center justify-center gap-1.5"><Globe size={14} /> Импорт с карты (реальный)</span>
          </button>

          {/* Upload heightmap */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-secondary w-full text-xs py-2"
            >
              {uploading ? 'Загрузка...' : <span className="flex items-center justify-center gap-1.5"><Upload size={14} /> Свой heightmap (PNG)</span>}
            </button>
          </div>

          {/* Remove heightmap */}
          {terrainUrl && (
            <button
              onClick={handleRemoveTerrain}
              className="btn-danger w-full text-xs"
            >
              <span className="flex items-center justify-center gap-1.5"><Trash2 size={14} /> Удалить heightmap</span>
            </button>
          )}

          {/* Procedural toggle */}
          {/* Процедурный рельеф лишь перекрывает загруженный, не стирая его:
              раньше здесь был setTerrainUrl(null) и вернуться к импортированной
              карте было уже нельзя. */}
          <button
            onClick={() => setProceduralTerrain(!proceduralTerrain)}
            className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              proceduralTerrain
                ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5"><Dices size={14} /> Процедурный рельеф</span>
          </button>

          {/* Wireframe toggle */}
          <button
            onClick={() => setWireframe(!wireframe)}
            className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              wireframe
                ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5"><Grid3x3 size={14} /> Каркас</span>
          </button>

          {/* Здания OSM (только для импортированного реального рельефа) */}
          {terrainMeta?.buildingsUrl && (
            <button
              onClick={() => setShowBuildings(!showBuildings)}
              className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showBuildings
                  ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                  : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Building2 size={14} /> Здания · {terrainMeta.buildingCount ?? 0}
              </span>
            </button>
          )}

          {/* Природа OSM: лес и водоёмы */}
          {terrainMeta?.natureUrl && (
            <button
              onClick={() => setShowNature(!showNature)}
              className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showNature
                  ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                  : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Trees size={14} /> Лес {terrainMeta.forestCount ?? 0} · вода {terrainMeta.waterCount ?? 0}
              </span>
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-300 bg-red-500/15 rounded-lg px-2 py-1">
              {error}
            </div>
          )}

          {/* Hint */}
          <p className="text-[10px] text-muted leading-relaxed">
            Heightmap PNG: чёрно-белое изображение, где яркость = высота. Рекомендуется 256×256 или 512×512.
          </p>
        </div>
      )}

      {mapOpen && (
        <MapImportModal
          projectId={projectId}
          centerLat={centerLat}
          centerLng={centerLng}
          onClose={() => setMapOpen(false)}
          onImported={(url, meta) => {
            setTerrainUrl(url);
            setTerrainMeta(meta);
            setProceduralTerrain(false);
            queryClient.invalidateQueries({ queryKey: ['project', projectId] });
          }}
        />
      )}
    </div>
  );
}
