import { useEffect, useState } from 'react';
import { useViewerStore } from '../stores/viewerStore';
import { sceneApi } from '../../../shared/api';

/**
 * Side panel for the selected object.
 *
 * Features:
 * - Editable position/rotation/scale (numeric inputs)
 * - Lock/Unlock toggle (locked by default — cannot transform without unlock)
 * - Edit/Undo/Redo/Reset buttons
 * - Description + Doc URL (editable)
 * - Soft-delete/Restore (Master)
 *
 * Panel positioned at right-4 top-16 (below top nav, doesn't overlap model library)
 */
export default function ObjectInfoPanel({ projectId }: { projectId: string }) {
  const selectedId = useViewerStore((s) => s.selectedObjectId);
  const objects = useViewerStore((s) => s.objects);
  const selectObject = useViewerStore((s) => s.selectObject);
  const mode = useViewerStore((s) => s.mode);
  const setMode = useViewerStore((s) => s.setMode);
  const role = useViewerStore((s) => s.role);
  const updateObject = useViewerStore((s) => s.updateObject);
  const undo = useViewerStore((s) => s.undo);
  const redo = useViewerStore((s) => s.redo);
  const resetTransform = useViewerStore((s) => s.resetTransform);
  const history = useViewerStore((s) => s.history);
  const historyIndex = useViewerStore((s) => s.historyIndex);

  const [editMeta, setEditMeta] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState('');

  // Numeric edit drafts
  const [posDraft, setPosDraft] = useState<[number, number, number]>([0, 0, 0]);
  const [rotDraft, setRotDraft] = useState<[number, number, number]>([0, 0, 0]);
  const [sclDraft, setSclDraft] = useState<number>(1);

  const obj = objects.find((o) => o.id === selectedId);

  // Sync drafts — MUST be before any early return
  useEffect(() => {
    if (!obj) return;
    setDescDraft(obj.description ?? '');
    setUrlDraft(obj.docUrl ?? '');
    setPosDraft([...obj.position] as [number, number, number]);
    setRotDraft([...obj.rotation] as [number, number, number]);
    setSclDraft(obj.scale[0]);
  }, [obj?.id, obj?.description, obj?.docUrl, obj?.position, obj?.rotation, obj?.scale]);

  // Ctrl+Z hotkeys — MUST be before any early return
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const st = useViewerStore.getState();
        st.undo();
        const entry = st.history[st.historyIndex];
        if (entry) {
          const o = st.objects.find((o) => o.id === entry.objectId);
          if (o) {
            sceneApi.updateObject(projectId, o.id, {
              position: o.position, rotation: o.rotation, scale: o.scale,
            }).catch(() => {});
          }
        }
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        const st = useViewerStore.getState();
        st.redo();
        const entry = st.history[st.historyIndex + 1];
        if (entry) {
          sceneApi.updateObject(projectId, entry.objectId, {
            position: entry.newPosition, rotation: entry.newRotation, scale: entry.newScale,
          }).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, history, historyIndex]);

  if (!obj) return null;

  const isHidden = obj.hidden;
  const isLocked = obj.locked ?? true;
  const isEditing = mode === 'master-edit' || mode === 'partition-edit';
  const canEdit = role === 'MASTER' || (role === 'DESIGNER' && obj.authorId === useViewerStore.getState().role);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  // Numeric transform apply
  const handleApplyTransform = async () => {
    const newPos = posDraft;
    const newRot: [number, number, number] = [
      rotDraft[0] * Math.PI / 180,
      rotDraft[1] * Math.PI / 180,
      rotDraft[2] * Math.PI / 180,
    ];
    const newScl: [number, number, number] = [sclDraft, sclDraft, sclDraft];

    updateObject(obj.id, { position: newPos, rotation: newRot, scale: newScl });
    try {
      await sceneApi.updateObject(projectId, obj.id, {
        position: newPos, rotation: newRot, scale: newScl,
      });
    } catch (err) {
      console.error('Failed to save transform:', err);
    }
  };

  const handleToggleLock = async () => {
    const newLocked = !isLocked;
    updateObject(obj.id, { locked: newLocked });
    try {
      await sceneApi.updateObject(projectId, obj.id, { locked: newLocked });
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    }
  };

  const handleEditToggle = () => {
    if (isEditing) {
      setMode('view');
    } else {
      setMode(role === 'MASTER' ? 'master-edit' : 'partition-edit');
    }
  };

  const handleSaveMeta = async () => {
    updateObject(obj.id, { description: descDraft, docUrl: urlDraft });
    try {
      await sceneApi.updateObject(projectId, obj.id, {
        description: descDraft, docUrl: urlDraft || undefined,
      });
    } catch (err) {
      console.error('Failed to save metadata:', err);
    }
    setEditMeta(false);
  };

  const handleReset = async () => {
    resetTransform(obj.id);
    try {
      await sceneApi.updateObject(projectId, obj.id, {
        position: obj.position, rotation: [0, 0, 0], scale: [1, 1, 1],
      });
    } catch (err) {
      console.error('Failed to reset transform:', err);
    }
  };

  const handleHide = async () => {
    try {
      await sceneApi.deleteObject(projectId, obj.id);
      updateObject(obj.id, { hidden: true });
    } catch (err) {
      console.error('Failed to hide object:', err);
    }
  };

  const handleRestore = async () => {
    try {
      await sceneApi.restoreObject(projectId, obj.id);
      updateObject(obj.id, { hidden: false });
    } catch (err) {
      console.error('Failed to restore:', err);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const inputClass = "w-16 px-1.5 py-1 text-xs bg-slate-800 text-slate-100 rounded border border-slate-600 focus:ring-1 focus:ring-vovplan-500 text-right";

  return (
    <div className="glass w-72 max-w-[80vw] max-h-full overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-800 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {isLocked && <span className="text-amber-400 text-sm flex-shrink-0">🔒</span>}
          <h3 className="text-white font-semibold text-sm truncate">{obj.name}</h3>
        </div>
        <button
          onClick={() => selectObject(null)}
          className="text-slate-400 hover:text-white text-lg leading-none flex-shrink-0 ml-2"
        >×</button>
      </div>

      {/* Meta */}
      <div className="p-4 space-y-2 text-sm">
        <InfoRow label="Автор" value={obj.authorName} />
        <InfoRow label="Размещён" value={formatDate(obj.createdAt)} />
        <InfoRow label="Видимость" value={obj.visible ? 'Видим' : 'Скрыт'} />

        {isHidden && (
          <div className="mt-2 p-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 text-xs">
            ⚠ Объект скрыт (soft-delete). Виден только Мастеру.
          </div>
        )}
      </div>

      {/* Numeric transform fields */}
      <div className="px-4 pb-3 space-y-2">
        <label className="text-xs text-slate-400 block">Позиция (X, Y, Z)</label>
        <div className="flex gap-1">
          <input type="number" step="0.1" value={posDraft[0].toFixed(1)}
            onChange={(e) => setPosDraft([parseFloat(e.target.value) || 0, posDraft[1], posDraft[2]])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
          <input type="number" step="0.1" value={posDraft[1].toFixed(1)}
            onChange={(e) => setPosDraft([posDraft[0], parseFloat(e.target.value) || 0, posDraft[2]])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
          <input type="number" step="0.1" value={posDraft[2].toFixed(1)}
            onChange={(e) => setPosDraft([posDraft[0], posDraft[1], parseFloat(e.target.value) || 0])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
        </div>

        <label className="text-xs text-slate-400 block">Поворот (°)</label>
        <div className="flex gap-1">
          <input type="number" step="1" value={Math.round(rotDraft[0] * 180 / Math.PI)}
            onChange={(e) => setRotDraft([parseFloat(e.target.value) || 0, rotDraft[1], rotDraft[2]])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
          <input type="number" step="1" value={Math.round(rotDraft[1] * 180 / Math.PI)}
            onChange={(e) => setRotDraft([rotDraft[0], parseFloat(e.target.value) || 0, rotDraft[2]])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
          <input type="number" step="1" value={Math.round(rotDraft[2] * 180 / Math.PI)}
            onChange={(e) => setRotDraft([rotDraft[0], rotDraft[1], parseFloat(e.target.value) || 0])}
            className={inputClass} disabled={isLocked || !canEdit}
          />
        </div>

        <label className="text-xs text-slate-400 block">Масштаб</label>
        <input type="number" step="0.1" value={sclDraft.toFixed(2)}
          onChange={(e) => setSclDraft(parseFloat(e.target.value) || 1)}
          className={inputClass + " w-full"} disabled={isLocked || !canEdit}
        />

        {canEdit && !isHidden && !isLocked && (
          <button
            onClick={handleApplyTransform}
            className="w-full px-3 py-1.5 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-700"
          >✓ Применить</button>
        )}
      </div>

      {/* Description + Doc URL */}
      <div className="px-4 pb-3 space-y-2">
        {editMeta ? (
          <>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Описание</label>
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={2}
                placeholder="Информация об объекте..."
                className="w-full px-2 py-1.5 text-sm bg-slate-800 text-slate-100 rounded-lg border border-slate-600 focus:ring-2 focus:ring-vovplan-500 resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">URL документации</label>
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://..."
                className="w-full px-2 py-1.5 text-sm bg-slate-800 text-slate-100 rounded-lg border border-slate-600 focus:ring-2 focus:ring-vovplan-500"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveMeta}
                className="flex-1 px-3 py-1.5 bg-vovplan-600 text-white rounded-lg text-xs font-medium hover:bg-vovplan-700"
              >✓ Сохранить</button>
              <button onClick={() => { setEditMeta(false); setDescDraft(obj.description ?? ''); setUrlDraft(obj.docUrl ?? ''); }}
                className="flex-1 px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-xs font-medium hover:bg-slate-600"
              >Отмена</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Описание</label>
                {canEdit && !isHidden && (
                  <button onClick={() => setEditMeta(true)} className="text-xs text-vovplan-400 hover:text-vovplan-300">✏️</button>
                )}
              </div>
              <p className="text-sm text-slate-200 mt-0.5">
                {obj.description || <span className="text-slate-500 italic">Нет описания</span>}
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400">Документация</label>
              {obj.docUrl ? (
                <a href={obj.docUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-vovplan-400 hover:text-vovplan-300 underline truncate block mt-0.5"
                >{obj.docUrl}</a>
              ) : (
                <p className="text-sm text-slate-500 italic mt-0.5">Нет ссылки</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 space-y-2">
        {/* Lock / Unlock */}
        {canEdit && !isHidden && (
          <button
            onClick={handleToggleLock}
            className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isLocked
                ? 'bg-amber-700 text-amber-100 hover:bg-amber-600'
                : 'bg-green-700 text-green-100 hover:bg-green-600'
            }`}
          >
            {isLocked ? '🔒 Заблокировано' : '🔓 Разблокировано'}
          </button>
        )}

        {/* Edit / Done */}
        {canEdit && !isHidden && !isLocked && (
          <button
            onClick={handleEditToggle}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isEditing
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-vovplan-600 text-white hover:bg-vovplan-700'
            }`}
          >
            {isEditing ? '✓ Готово' : '✏️ Изменить'}
          </button>
        )}

        {/* Undo / Redo / Reset */}
        {canEdit && !isHidden && !isLocked && isEditing && (
          <div className="flex gap-2">
            <button onClick={handleReset} disabled={!canEdit}
              className="flex-1 px-2 py-2 bg-slate-700 text-slate-200 rounded-lg text-xs font-medium hover:bg-slate-600"
              title="Вернуть исходные параметры"
            >↺ Исходные</button>
            <button onClick={undo} disabled={!canUndo}
              className="flex-1 px-2 py-2 bg-slate-700 text-slate-200 rounded-lg text-xs font-medium hover:bg-slate-600 disabled:opacity-30"
              title="Шаг назад (Ctrl+Z)"
            >↩</button>
            <button onClick={redo} disabled={!canRedo}
              className="flex-1 px-2 py-2 bg-slate-700 text-slate-200 rounded-lg text-xs font-medium hover:bg-slate-600 disabled:opacity-30"
              title="Шаг вперёд (Ctrl+Shift+Z)"
            >↪</button>
          </div>
        )}

        {/* Soft-delete / Restore */}
        {role === 'MASTER' && (
          isHidden ? (
            <button onClick={handleRestore}
              className="w-full px-4 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-600"
            >↺ Восстановить</button>
          ) : (
            <button onClick={handleHide}
              className="w-full px-4 py-2 bg-red-900/50 text-red-300 rounded-lg text-sm font-medium hover:bg-red-900/70"
            >🗑 Скрыть</button>
          )
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  );
}
