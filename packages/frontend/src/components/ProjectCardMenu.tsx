import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Pencil, Archive, ArchiveRestore, Trash2, Users, History, Image as ImageIcon,
} from 'lucide-react';
import { projectsApi } from '../shared/api';
import type { Project } from '@vovplan/shared';

/**
 * Меню карточки проекта: переименование, описание, значок, архивирование,
 * удаление и переходы к доступам и истории изменений.
 *
 * Действия доступны только владельцу (MASTER) — у остальных ролей шестерёнка
 * не показывается, чтобы не предлагать заведомо запрещённое.
 */
export default function ProjectCardMenu({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isArchived = project.status === 'ARCHIVED';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects'] });

  const patch = useMutation({
    mutationFn: (data: Parameters<typeof projectsApi.update>[1]) => projectsApi.update(project.id, data),
    onSuccess: () => { refresh(); setEditing(false); setOpen(false); },
  });
  const remove = useMutation({
    mutationFn: () => projectsApi.delete(project.id),
    onSuccess: () => { refresh(); setConfirmDelete(false); setOpen(false); },
  });
  const setIcon = useMutation({
    mutationFn: (file: File) => projectsApi.uploadIcon(project.id, file),
    onSuccess: () => { refresh(); setOpen(false); },
  });

  // Клик мимо и Escape закрывают меню
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item =
    'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg transition-colors ' +
    'text-slate-700 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5';

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="Настройки проекта"
        aria-label="Настройки проекта"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-900/5 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
      >
        <Settings size={16} />
      </button>

      {open && !editing && !confirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-9 z-30 w-56 p-1.5 rounded-xl shadow-xl border bg-white border-slate-200 dark:bg-slate-900 dark:border-white/10"
        >
          <button className={item} onClick={() => setEditing(true)}>
            <Pencil size={15} /> Название и описание
          </button>
          <button className={item} onClick={() => iconRef.current?.click()} disabled={setIcon.isPending}>
            <ImageIcon size={15} /> {setIcon.isPending ? 'Загрузка...' : 'Значок проекта'}
          </button>

          <div className="h-px my-1.5 bg-slate-900/10 dark:bg-white/10" />

          <button className={item} onClick={() => navigate(`/projects/${project.id}?tab=members`)}>
            <Users size={15} /> Доступы
          </button>
          <button className={item} onClick={() => navigate(`/projects/${project.id}?tab=activity`)}>
            <History size={15} /> История изменений
          </button>

          <div className="h-px my-1.5 bg-slate-900/10 dark:bg-white/10" />

          <button
            className={item}
            onClick={() => patch.mutate({ status: isArchived ? 'ACTIVE' : 'ARCHIVED' })}
            disabled={patch.isPending}
          >
            {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {isArchived ? 'Вернуть в работу' : 'В архив'}
          </button>
          <button
            className={`${item} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} /> Удалить проект
          </button>

          {(patch.error || setIcon.error) && (
            <p className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
              {(patch.error as Error)?.message ?? (setIcon.error as Error)?.message}
            </p>
          )}
        </div>
      )}

      <input
        ref={iconRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setIcon.mutate(f);
          e.target.value = '';
        }}
      />

      {editing && (
        <EditDialog
          project={project}
          busy={patch.isPending}
          error={(patch.error as Error)?.message}
          onCancel={() => { setEditing(false); setOpen(false); }}
          onSave={(name, description) => patch.mutate({ name, description })}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить проект?"
          text={`Проект «${project.name}» и вся его сцена будут удалены безвозвратно.`}
          busy={remove.isPending}
          error={(remove.error as Error)?.message}
          onCancel={() => { setConfirmDelete(false); setOpen(false); }}
          onConfirm={() => remove.mutate()}
        />
      )}
    </div>
  );
}

// ── Диалоги ───────────────────────────────────

function Overlay({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md p-6 rounded-2xl shadow-2xl border bg-white border-slate-200 dark:bg-slate-900 dark:border-white/10"
      >
        {children}
      </div>
    </div>
  );
}

function EditDialog({
  project, busy, error, onCancel, onSave,
}: {
  project: Project;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(name.trim(), description.trim());
  };

  return (
    <Overlay onCancel={onCancel}>
      <h3 className="font-display text-xl font-bold tracking-tight text-strong mb-5">Изменить проект</h3>
      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="pe-name" className="input-label">Название</label>
          <input
            id="pe-name" className="input-field" required minLength={2} maxLength={100}
            value={name} onChange={(e) => setName(e.target.value)} autoFocus
          />
        </div>
        <div>
          <label htmlFor="pe-desc" className="input-label">Описание</label>
          <textarea
            id="pe-desc" className="input-field" rows={3} maxLength={1000}
            value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Краткое описание проекта"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">Отмена</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function ConfirmDialog({
  title, text, busy, error, onCancel, onConfirm,
}: {
  title: string;
  text: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay onCancel={onCancel}>
      <h3 className="font-display text-xl font-bold tracking-tight text-strong mb-2">{title}</h3>
      <p className="text-sm text-muted mb-5">{text}</p>
      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">Отмена</button>
        <button
          type="button" onClick={onConfirm} disabled={busy}
          className="flex-1 px-4 py-2 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] transition disabled:opacity-40"
        >
          {busy ? 'Удаление...' : 'Удалить'}
        </button>
      </div>
    </Overlay>
  );
}
