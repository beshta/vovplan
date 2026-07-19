import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { presetsApi } from '../../../shared/api';
import type { CameraPresetPayload } from '../../../shared/api';
import { useViewerStore } from '../stores/viewerStore';

interface PresetsBarProps {
  projectId: string;
  canEdit: boolean;
}

/**
 * Панель пресетов камеры — «закладки вида» внизу по центру.
 * Клик — плавный перелёт; DESIGNER+ может сохранять текущий вид и удалять пресеты.
 */
export default function PresetsBar({ projectId, canEdit }: PresetsBarProps) {
  const queryClient = useQueryClient();
  const flyTo = useViewerStore((s) => s.flyTo);
  const cameraGetter = useViewerStore((s) => s.cameraGetter);
  const cameraView = useViewerStore((s) => s.cameraView);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const { data } = useQuery({
    queryKey: ['presets', projectId],
    queryFn: () => presetsApi.list(projectId),
    enabled: !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: (n: string) => {
      const pose = cameraGetter?.();
      if (!pose) throw new Error('Камера недоступна');
      return presetsApi.create(projectId, { name: n, position: pose.position, target: pose.target });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets', projectId] });
      setSaving(false);
      setName('');
    },
    onError: (e) => console.error('[PresetsBar] Не удалось сохранить пресет:', e),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => presetsApi.remove(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presets', projectId] }),
  });

  const presets = data?.data ?? [];
  if (cameraView === 'first-person') return null;
  if (presets.length === 0 && !canEdit) return null;

  return (
    <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur rounded-full px-2 py-1.5 shadow-xl max-w-[70%] overflow-x-auto">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 px-1 shrink-0">Виды</span>

      {presets.map((p: CameraPresetPayload) => (
        <span key={p.id} className="group relative shrink-0">
          <button
            onClick={() => flyTo({ position: p.position, target: p.target })}
            className="px-3 py-1 rounded-full text-xs bg-slate-800 text-slate-200 hover:bg-vovplan-600 hover:text-white transition-colors"
            title={`Перейти к виду «${p.name}»`}
          >
            {p.name}
          </button>
          {canEdit && (
            <button
              onClick={() => removeMutation.mutate(p.id)}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-red-600 text-white text-[9px] leading-none"
              title="Удалить пресет"
            >
              ×
            </button>
          )}
        </span>
      ))}

      {canEdit && !saving && (
        <button
          onClick={() => setSaving(true)}
          className="px-3 py-1 rounded-full text-xs bg-slate-800 text-slate-400 hover:text-white border border-dashed border-slate-600 shrink-0"
          title="Сохранить текущий вид как пресет"
        >
          + Вид
        </button>
      )}

      {canEdit && saving && (
        <form
          className="flex items-center gap-1 shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate(name.trim());
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSaving(false)}
            placeholder="Название вида"
            className="w-32 px-2 py-1 rounded-full text-xs bg-slate-800 text-white border border-slate-600 focus:border-vovplan-500 outline-none"
          />
          <button type="submit" className="px-2 py-1 rounded-full text-xs bg-vovplan-600 text-white">
            ✓
          </button>
          <button type="button" onClick={() => setSaving(false)} className="px-2 py-1 rounded-full text-xs bg-slate-700 text-slate-300">
            ✕
          </button>
        </form>
      )}
    </div>
  );
}
