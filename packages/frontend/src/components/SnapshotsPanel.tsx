import { useState } from 'react';
import { History, Save, RotateCcw, Trash2, Box, Wrench, MapPin } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { snapshotsApi } from '../shared/api';
import type { SnapshotPayload } from '../shared/api';

/**
 * История версий сцены (вкладка «Версии»). DESIGNER+ сохраняет снимок
 * текущего состояния; MASTER восстанавливает или удаляет версии.
 */
export default function SnapshotsPanel({ projectId, isMaster, canEdit }: { projectId: string; isMaster: boolean; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['snapshots', projectId],
    queryFn: () => snapshotsApi.list(projectId),
  });

  const create = useMutation({
    mutationFn: () => snapshotsApi.create(projectId, name.trim() || `Версия ${new Date().toLocaleString('ru-RU')}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] }); setName(''); setNotice('Версия сохранена'); setTimeout(() => setNotice(''), 2000); },
  });

  const restore = useMutation({
    mutationFn: (id: string) => snapshotsApi.restore(projectId, id),
    onSuccess: () => {
      // Сцена в БД заменена — сбрасываем кэши, чтобы вьювер перечитал
      queryClient.invalidateQueries({ queryKey: ['scene-objects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['utilities', projectId] });
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setConfirmRestore(null);
      setNotice('Версия восстановлена — откройте 3D-сцену');
      setTimeout(() => setNotice(''), 3000);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => snapshotsApi.remove(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] }),
  });

  const snaps = data?.data ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto text-slate-700 dark:text-slate-200 h-full overflow-y-auto">
      <h2 className="text-xl font-semibold text-strong tracking-tight mb-1 flex items-center gap-2">
        <History size={20} className="text-vovplan-400" /> Версии сцены
      </h2>
      <p className="text-sm text-muted mb-5">Сохраняйте снимки состояния сцены для согласований и возвращайтесь к любой версии.</p>

      {notice && <div className="mb-4 p-3 bg-vovplan-600/20 text-vovplan-200 rounded-xl text-sm">{notice}</div>}

      {/* Сохранить текущую версию */}
      {canEdit && (
        <div className="glass p-4 mb-4 flex flex-wrap gap-2 items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название версии (например: «До правок заказчика»)"
            className="input-field flex-1 min-w-52 text-sm"
          />
          <button onClick={() => create.mutate()} disabled={create.isPending} className="btn-primary text-sm">
            <span className="flex items-center gap-1.5"><Save size={15} /> Сохранить версию</span>
          </button>
        </div>
      )}

      {/* Список версий */}
      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-4">Загрузка...</p>
      ) : snaps.length === 0 ? (
        <div className="glass p-8 text-center text-slate-500 dark:text-slate-400">
          <History size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Версий пока нет. Сохраните первую — и сможете вернуться к ней в любой момент.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {snaps.map((s: SnapshotPayload) => (
            <li key={s.id} className="glass p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-strong truncate">{s.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {s.authorName} · {new Date(s.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex gap-3 mt-2 text-[11px] text-muted">
                    <span className="flex items-center gap-1"><Box size={12} /> {s.counts.objects}</span>
                    <span className="flex items-center gap-1"><Wrench size={12} /> {s.counts.utilities}</span>
                    <span className="flex items-center gap-1"><MapPin size={12} /> {s.counts.annotations}</span>
                  </div>
                </div>
                {isMaster && (
                  <div className="flex items-center gap-2 shrink-0">
                    {confirmRestore === s.id ? (
                      <>
                        <button onClick={() => restore.mutate(s.id)} disabled={restore.isPending} className="btn-primary text-xs py-1.5">
                          Заменить сцену
                        </button>
                        <button onClick={() => setConfirmRestore(null)} className="btn-ghost text-xs">Отмена</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setConfirmRestore(s.id)} className="btn-secondary text-xs py-1.5" title="Восстановить эту версию">
                          <span className="flex items-center gap-1"><RotateCcw size={13} /> Восстановить</span>
                        </button>
                        <button onClick={() => remove.mutate(s.id)} className="text-slate-500 dark:text-slate-400 hover:text-red-400 transition-colors p-1" title="Удалить версию">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {confirmRestore === s.id && (
                <p className="text-[11px] text-amber-300/90 mt-2">
                  Текущие объекты, сети и аннотации будут заменены содержимым этой версии. Действие необратимо (но можно сначала сохранить текущее состояние отдельной версией).
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
