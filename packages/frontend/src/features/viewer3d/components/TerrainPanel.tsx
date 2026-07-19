import { useRef, useState } from 'react';
import { useViewerStore } from '../stores/viewerStore';
import { terrainApi } from '../../../shared/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Terrain control panel — upload DEM heightmap, toggle procedural/flat/wireframe.
 *
 * Collapsible panel, floats in the top-right area below the toolbar.
 * Only visible for editors (MASTER, DESIGNER).
 */
export default function TerrainPanel({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const terrainUrl = useViewerStore((s) => s.terrainUrl);
  const setTerrainUrl = useViewerStore((s) => s.setTerrainUrl);
  const proceduralTerrain = useViewerStore((s) => s.proceduralTerrain);
  const setProceduralTerrain = useViewerStore((s) => s.setProceduralTerrain);
  const wireframe = useViewerStore((s) => s.wireframe);
  const setWireframe = useViewerStore((s) => s.setWireframe);

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
        <span className="hud-title">🏔️ Ландшафт</span>
        <span className="text-slate-500 text-xs">{collapsed ? '▾' : '▴'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/10 pt-2.5">
          {/* Current mode badge */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Режим:</span>
            <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-medium">
              {terrainUrl ? 'DEM heightmap' : proceduralTerrain ? 'Процедурный' : 'Плоский'}
            </span>
          </div>

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
              className="btn-primary w-full text-xs py-2"
            >
              {uploading ? '⏳ Загрузка...' : '⬆ Загрузить heightmap (PNG)'}
            </button>
          </div>

          {/* Remove heightmap */}
          {terrainUrl && (
            <button
              onClick={handleRemoveTerrain}
              className="btn-danger w-full text-xs"
            >
              🗑 Удалить heightmap
            </button>
          )}

          {/* Procedural toggle */}
          <button
            onClick={() => {
              setProceduralTerrain(!proceduralTerrain);
              if (!proceduralTerrain) setTerrainUrl(null);
            }}
            className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              proceduralTerrain && !terrainUrl
                ? 'bg-vovplan-600/20 text-vovplan-200 ring-1 ring-vovplan-500/30'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            🎲 Процедурный рельеф
          </button>

          {/* Wireframe toggle */}
          <button
            onClick={() => setWireframe(!wireframe)}
            className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              wireframe
                ? 'bg-vovplan-600/20 text-vovplan-200 ring-1 ring-vovplan-500/30'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            🔲 Каркас (wireframe)
          </button>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-300 bg-red-500/15 rounded-lg px-2 py-1">
              {error}
            </div>
          )}

          {/* Hint */}
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Heightmap PNG: чёрно-белое изображение, где яркость = высота. Рекомендуется 256×256 или 512×512.
          </p>
        </div>
      )}
    </div>
  );
}
