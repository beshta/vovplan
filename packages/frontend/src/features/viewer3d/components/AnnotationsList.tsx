import { useState } from 'react';
import { useViewerStore } from '../stores/viewerStore';
import { commentsApi } from '../../../shared/api';
import { useQueryClient } from '@tanstack/react-query';

const TYPE_ICONS: Record<string, string> = {
  pin: '📍',
  arrow: '➤',
  line: '📏',
  freehand: '✏️',
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
        <span className="hud-title">📝 Аннотации</span>
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
          {annotations.map((ann) => (
            <div
              key={ann.id}
              className={`flex items-start gap-2 px-2.5 py-2 rounded-xl text-xs ${
                ann.resolved ? 'bg-emerald-500/10 opacity-60' : 'bg-white/5'
              }`}
            >
              {/* Type icon */}
              <span className="flex-shrink-0">{TYPE_ICONS[ann.type] ?? '💬'}</span>

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
                  onClick={() => handleResolve(ann.id, ann.resolved)}
                  className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors"
                  title={ann.resolved ? 'Снять resolved' : 'Отметить решённым'}
                >
                  {ann.resolved ? '↺' : '✓'}
                </button>
                <button
                  onClick={() => handleDelete(ann.id)}
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
          ))}
        </div>
      )}
    </div>
  );
}
