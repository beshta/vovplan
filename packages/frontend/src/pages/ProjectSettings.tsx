import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Save } from 'lucide-react';
import { projectsApi } from '../shared/api';

/**
 * Настройки проекта.
 *
 * Раньше здесь лежала справка: три строки, которые нельзя тронуть. Название и
 * описание при этом менялись только из меню карточки на списке проектов — то
 * есть из совсем другого места, куда изнутри проекта ещё надо догадаться выйти.
 */

const STATUSES: { value: string; label: string; hint: string }[] = [
  { value: 'DRAFT', label: 'Черновик', hint: 'Работа идёт, показывать рано' },
  { value: 'ACTIVE', label: 'В работе', hint: 'Проект живёт и обсуждается' },
  { value: 'ARCHIVED', label: 'В архиве', hint: 'Закончен, остаётся для истории' },
];

export default function ProjectSettings({
  projectId,
  project,
  onOpenExport,
}: {
  projectId: string;
  project: any;
  /** Увести к 3D-сцене с раскрытой панелью выгрузки */
  onOpenExport: () => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = project.myRole === 'MASTER';

  const [name, setName] = useState(project.name ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState(project.status ?? 'DRAFT');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== (project.name ?? '') ||
    description !== (project.description ?? '') ||
    status !== (project.status ?? 'DRAFT');

  const save = async () => {
    if (!name.trim()) {
      setError('Без названия проект не найти в списке');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await projectsApi.update(projectId, { name: name.trim(), description, status });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto overflow-y-auto h-full space-y-6">
      <h2 className="font-display text-xl font-bold tracking-tight text-strong">Настройки проекта</h2>

      <section className="glass p-4 space-y-3">
        <label className="block">
          <span className="text-xs text-muted">Название</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            maxLength={120}
            className="input-field mt-1"
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted">Описание</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            rows={3}
            placeholder="Чем занимается проект и что в нём искать"
            className="input-field mt-1 resize-y"
          />
        </label>

        <div>
          <span className="text-xs text-muted">Состояние</span>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                disabled={!canEdit}
                title={s.hint}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                  status === s.value
                    ? 'bg-vovplan-600 text-white'
                    : 'bg-slate-900/5 text-muted hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {canEdit && (
          <button onClick={save} disabled={!dirty || saving} className="btn-primary w-full text-sm">
            <span className="flex items-center justify-center gap-1.5">
              <Save size={15} />
              {saving ? 'Сохраняю…' : saved ? 'Сохранено' : 'Сохранить'}
            </span>
          </button>
        )}
        {!canEdit && (
          <p className="text-xs text-muted">Менять настройки может только Мастер проекта.</p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </section>

      {/* Выгрузка сцены.
          Здесь только указатель: файл собирается из того, что сейчас загружено
          в браузере, поэтому собирать его можно лишь при открытой 3D-сцене.
          Раньше на этом месте стояла заглушка «Премиум» с заблокированной
          кнопкой — теперь выгрузка есть и работает, и врать про замок нельзя. */}
      <section className="glass p-4 space-y-2">
        <h3 className="text-sm font-semibold text-strong">Выгрузка сцены</h3>
        <p className="text-xs text-muted leading-relaxed">
          Расставленные модели, ограждения и сети — одним файлом glTF, рельеф по
          выбору. Открывается в Blender, 3ds&nbsp;Max, SketchUp и любом просмотрщике.
        </p>
        <button onClick={onOpenExport} className="btn-secondary w-full text-sm">
          <span className="flex items-center justify-center gap-1.5">
            <Download size={15} /> Открыть выгрузку в 3D-сцене
          </span>
        </button>
      </section>

      <section className="glass divide-y divide-slate-900/5 dark:divide-white/5">
        {[
          ['ID проекта', projectId],
          ['Координаты центра', `${project.centerLat}, ${project.centerLng}`],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-muted">{k}</span>
            <span className="font-mono text-strong truncate">{v}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
