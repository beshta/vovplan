import { useEffect, useState } from 'react';
import { MessageSquareText, Trash2, X, Eye, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useViewerStore } from '../stores/viewerStore';
import { commentsApi } from '../../../shared/api';

const PALETTE = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const TYPE_LABELS: Record<string, string> = { pin: 'Метка', arrow: 'Стрелка', line: 'Линия', freehand: 'От руки' };

/**
 * Редактор выбранной аннотации: текст, цвет, толщина линии, скрыть (resolved),
 * удалить. Открывается кликом по аннотации или сразу после её рисования.
 * Правит автор или MASTER.
 */
export default function AnnotationEditPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const selectedId = useViewerStore((s) => s.selectedAnnotationId);
  const selectAnnotation = useViewerStore((s) => s.selectAnnotation);
  const annotations = useViewerStore((s) => s.annotations);
  const updateAnnotation = useViewerStore((s) => s.updateAnnotation);
  const removeAnnotation = useViewerStore((s) => s.removeAnnotation);

  const ann = annotations.find((a) => a.id === selectedId);

  const [text, setText] = useState('');
  const [color, setColor] = useState('#ef4444');
  const [width, setWidth] = useState(0.4);

  useEffect(() => {
    if (!ann) return;
    setText(ann.text);
    setColor(ann.color);
    setWidth(ann.width ?? 0.4);
  }, [ann?.id]);

  if (!ann) return null;

  const isPin = ann.type === 'pin';

  const save = async (patch: Record<string, unknown>) => {
    try {
      await commentsApi.update(projectId, ann.id, patch);
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
    } catch (err) {
      console.error('Не удалось сохранить аннотацию:', err);
    }
  };

  const handleDelete = async () => {
    try {
      await commentsApi.remove(projectId, ann.id);
      removeAnnotation(ann.id);
      selectAnnotation(null);
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
    } catch (err) {
      console.error('Не удалось удалить аннотацию:', err);
    }
  };

  const toggleHidden = async () => {
    const resolved = !ann.resolved;
    updateAnnotation(ann.id, { resolved });
    await save({ resolved });
  };

  return (
    <div className="glass w-64 max-h-full overflow-y-auto pointer-events-auto">
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between">
        <span className="hud-title flex items-center gap-1.5">
          <MessageSquareText size={14} /> {TYPE_LABELS[ann.type] ?? 'Аннотация'}
        </span>
        <button onClick={() => selectAnnotation(null)} className="text-slate-500 hover:text-white transition-colors" title="Закрыть">
          <X size={15} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Текст / примечание */}
        <div>
          <label className="input-label">Текст</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text !== ann.text && (updateAnnotation(ann.id, { text }), save({ text }))}
            rows={2}
            placeholder="Примечание к аннотации"
            className="input-field text-sm resize-none"
          />
        </div>

        {/* Цвет — палитра */}
        <div>
          <label className="input-label">Цвет</label>
          <div className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); updateAnnotation(ann.id, { color: c }); save({ color: c }); }}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-white/20'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Толщина (не для pin) */}
        {!isPin && (
          <label className="block text-xs text-slate-400">
            Толщина: <span className="text-slate-200">{width.toFixed(2)}м</span>
            <input
              type="range" min="0.1" max="2" step="0.1" value={width}
              onChange={(e) => { const v = parseFloat(e.target.value); setWidth(v); updateAnnotation(ann.id, { width: v }); }}
              onMouseUp={() => save({ width })} onTouchEnd={() => save({ width })}
              className="w-full mt-1"
            />
          </label>
        )}

        {/* Скрыть / показать */}
        <button
          onClick={toggleHidden}
          className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            ann.resolved ? 'bg-vovplan-600/20 text-vovplan-200 ring-1 ring-vovplan-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            {ann.resolved ? <><Eye size={14} /> Показать</> : <><EyeOff size={14} /> Скрыть (приглушить)</>}
          </span>
        </button>

        {/* Удалить */}
        <button onClick={handleDelete} className="btn-danger w-full text-xs">
          <span className="flex items-center justify-center gap-1.5"><Trash2 size={14} /> Удалить аннотацию</span>
        </button>

        <div className="text-[11px] text-slate-500">Автор: {ann.authorName}</div>
      </div>
    </div>
  );
}
