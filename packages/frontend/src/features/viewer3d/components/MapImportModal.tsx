import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Globe, Undo2, Trash2, Check, Loader2 } from 'lucide-react';
import { terrainApi } from '../../../shared/api';
import type { TerrainMeta } from '../../../shared/api';

interface MapImportModalProps {
  projectId: string;
  /** Начальный центр карты (координаты проекта) */
  centerLat?: number;
  centerLng?: number;
  onClose: () => void;
  onImported: (terrainUrl: string, meta: TerrainMeta) => void;
}

/**
 * Импорт реального ландшафта: пользователь рисует замкнутый периметр
 * на карте (OpenStreetMap), бэкенд вырезает область и притягивает
 * реальный рельеф (AWS Terrain Tiles) + спутниковую текстуру (Esri).
 */
export default function MapImportModal({
  projectId,
  centerLat = 55.7558,
  centerLng = 37.6173,
  onClose,
  onImported,
}: MapImportModalProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Инициализация карты ──
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, { zoomControl: true }).setView([centerLat, centerLng], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    leafletRef.current = map;
    layerRef.current = layer;

    map.on('click', (e: L.LeafletMouseEvent) => {
      setPoints((prev) => [...prev, e.latlng]);
    });

    return () => {
      map.remove();
      leafletRef.current = null;
      layerRef.current = null;
    };
  }, [centerLat, centerLng]);

  // ── Перерисовка полигона при изменении точек ──
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const p of points) {
      L.circleMarker(p, { radius: 5, color: '#6366f1', fillColor: '#6366f1', fillOpacity: 1 }).addTo(layer);
    }
    if (points.length >= 2) {
      L.polyline(points, { color: '#6366f1', weight: 2, dashArray: '6 4' }).addTo(layer);
    }
    if (points.length >= 3) {
      L.polygon(points, { color: '#6366f1', weight: 2, fillColor: '#6366f1', fillOpacity: 0.15 }).addTo(layer);
    }
  }, [points]);

  const handleImport = async () => {
    if (points.length < 3) return;
    setImporting(true);
    setError(null);
    try {
      const result = await terrainApi.importReal(
        projectId,
        points.map((p) => ({ lat: p.lat, lng: p.lng })),
      );
      onImported(result.terrainUrl, result.terrainMeta);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  // Портал: панель-родитель имеет backdrop-blur (containing block),
  // из-за чего fixed позиционировался бы относительно панели, а не окна
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
          <h2 className="hud-title flex items-center gap-2 text-sm">
            <Globe size={16} /> Импорт реального ландшафта
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" title="Закрыть">
            <X size={18} />
          </button>
        </div>

        {/* Map */}
        <div className="relative flex-1 min-h-0">
          <div ref={mapRef} className="absolute inset-0" />

          {/* Подсказка */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 z-[1000] glass rounded-full px-4 py-1.5 text-xs text-slate-300 pointer-events-none whitespace-nowrap">
            {points.length < 3
              ? `Кликайте по карте — обведите нужную область (точек: ${points.length}, нужно ≥ 3)`
              : `Периметр из ${points.length} точек готов — жмите «Импортировать»`}
          </div>

          {importing && (
            <div className="absolute inset-0 z-[1100] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-slate-200">
              <Loader2 size={36} className="animate-spin text-vovplan-400" />
              <p className="text-sm">Скачиваем рельеф и спутниковые снимки…</p>
              <p className="text-xs text-slate-500">Обычно 5–20 секунд</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2 shrink-0">
          {error && (
            <p className="text-xs text-red-300 bg-red-500/15 rounded-lg px-3 py-1.5 flex-1 min-w-0 truncate">{error}</p>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setPoints((p) => p.slice(0, -1))}
            disabled={points.length === 0 || importing}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            <Undo2 size={14} /> Точка назад
          </button>
          <button
            onClick={() => setPoints([])}
            disabled={points.length === 0 || importing}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            <Trash2 size={14} /> Очистить
          </button>
          <button
            onClick={handleImport}
            disabled={points.length < 3 || importing}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Check size={14} /> Импортировать область
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
