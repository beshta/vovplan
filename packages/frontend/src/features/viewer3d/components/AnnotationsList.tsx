import { useState } from 'react';
import { MessageSquareText, MapPin, MoveUpRight, Minus, Brush, MessageCircle } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';
import { commentsApi } from '../../../shared/api';
import { useQueryClient } from '@tanstack/react-query';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  pin: <MapPin size={14} />,
  arrow: <MoveUpRight size={14} />,
  line: <Minus size={14} />,
  freehand: <Brush size={14} />,
};

/**
 * Annotations list panel — shows all comments/annotations.
 * Allows resolve/unresolve and delete.
 *
 * Collapsible, floats in the bottom-right area.
 */
export default function AnnotationsList({ projectId }: { projectId: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const queryClient = useQueryClient();

  const annotations = useViewerStore((s) => s.annotations);
  const removeAnnotation = useViewerStore((s) => s.removeAnnotation);
  const selectedAnnotationId = useViewerStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useViewerStore((s) => s.selectAnnotation);
  const flyTo = useViewerStore((s) => s.flyTo);
  const cameraGetter = useViewerStore((s) => s.cameraGetter);

  // Выбор аннотации из списка + плавный перелёт камеры к её центру
  const handleSelect = (ann: (typeof annotations)[number]) => {
    selectAnnotation(ann.id);
    const pts = ann.points;
    if (!pts.length) return;

    // Центр аннотации и её размах
    const c: [number, number, number] = [0, 0, 0];
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
    let spread = 0;
    for (const p of pts) spread = Math.max(spread, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    const dist = Math.max(spread * 2.5, 15);

    // Сохраняем текущий угол обзора — только смещаем фокус на аннотацию
    const cur = cameraGetter?.();
    let dir: [number, number, number] = [0.6, 0.7, 0.6];
    if (cur) {
      const dx = cur.position[0] - cur.target[0];
      const dy = cur.position[1] - cur.target[1];
      const dz = cur.position[2] - cur.target[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      dir = [dx / len, dy / len, dz / len];
    } else {
      const len = Math.hypot(...dir);
      dir = [dir[0] / len, dir[1] / len, dir[2] / len];
    }

    flyTo({
      position: [c[0] + dir[0] * dist, c[1] + dir[1] * dist, c[2] + dir[2] * dist],
      target: c,
    });
  };

  if (annotations.length === 0) return null;

  const handleResolve = async (id: string, resolved: boolean) => {
    try {
      await commentsApi.update(projectId, id, { resolved: !resolved });
      // Update store — find and update the annotation
      const ann = annotations.find((a) => a.id === id);
      if (ann) {
        removeAnnotation(id);
        // Re-add with updated resolved status
        useViewerStore.getState().addAnnotation({ ...ann, resolved: !resolved });
      }
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
    } catch (err) {
      console.error('Failed to update annotation:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await commentsApi.remove(projectId, id);
      removeAnnotation(id);
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  };

  const unresolvedCount = annotations.filter((a) => !a.resolved).length;

  return (
    <div className="glass w-64">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3.5 py-2.5"
      >
        <span className="hud-title flex items-center gap-1.5"><MessageSquareText size={14} /> Аннотации</span>
        <div className="flex items-center gap-2">
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 bg-red-500/20 text-red-300 text-[10px] rounded-full font-medium">
              {unresolvedCount}
            </span>
          )}
          <span className="text-slate-500 text-xs">{collapsed ? '▾' : '▴'}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="px-2 pb-2 space-y-1 max-h-64 overflow-y-auto border-t border-white/10 pt-2">
          {annotations.map((ann) => {
            const isSelected = selectedAnnotationId === ann.id;
            return (
            <div
              key={ann.id}
              onClick={() => handleSelect(ann)}
              className={`flex items-start gap-2 px-2.5 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-vovplan-600/20 ring-1 ring-vovplan-500/40'
                  : ann.resolved ? 'bg-emerald-500/10 opacity-60 hover:opacity-80' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {/* Type icon */}
              <span className="flex-shrink-0 text-slate-400 mt-0.5">{TYPE_ICONS[ann.type] ?? <MessageCircle size={14} />}</span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-medium text-slate-200 truncate">{ann.authorName}</span>
                  {ann.resolved && <span className="text-emerald-400 text-[10px]">✓</span>}
                </div>
                <p className="text-slate-400 truncate">{ann.text}</p>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); handleResolve(ann.id, ann.resolved); }}
                  className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors"
                  title={ann.resolved ? 'Показать' : 'Скрыть (приглушить)'}
                >
                  {ann.resolved ? '↺' : '✓'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(ann.id); }}
                  className="text-[10px] text-slate-500 hover:text-red-400 transition-colors"
                  title="Удалить"
                >
                  ✕
                </button>
              </div>

              {/* Color dot */}
              <span
                className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: ann.color }}
              />
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
