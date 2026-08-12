import { useState } from 'react';
import { Map as MapIcon, MapPin, Plus, LogOut, Calendar } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { ROLE_LABELS, type Project } from '@vovplan/shared';
import ProjectCardMenu from '../components/ProjectCardMenu';
import { track } from '../shared/analytics';
import VerifyEmailBanner from '../components/VerifyEmailBanner';

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => {
      track('project.create');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
    },
  });

  const projects = projectsData?.data ?? [];

  return (
    <div className="min-h-screen surface-page">
      {/* Напоминание о неподтверждённом адресе — над шапкой, чтобы его
          нельзя было не заметить, но без блокировки работы */}
      <VerifyEmailBanner />

      {/* ── Шапка ── */}
      <header className="sticky top-0 z-20 border-b surface-bar">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-bold tracking-wide text-strong">VOVPLAN</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">3D-платформа проектов</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/account"
              title="Кабинет"
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-vovplan-500 via-violet-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                  {(user?.displayName ?? '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-sm text-muted hidden sm:block">{user?.displayName}</span>
            </Link>
            <button onClick={logout} className="btn-ghost flex items-center gap-1.5">
              <LogOut size={15} /> <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Контент ── */}
      <main className="max-w-7xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-strong">Мои проекты</h1>
            <p className="text-muted mt-1.5">
              {projects.length > 0
                ? `${projects.length} ${plural(projects.length, 'проект', 'проекта', 'проектов')}`
                : 'Пока пусто — создайте первый'}
            </p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 shrink-0">
            <Plus size={18} /> Создать проект
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-5 animate-pulse">
                <div className="h-5 bg-slate-200 dark:bg-white/10 rounded w-2/3 mb-3" />
                <div className="h-4 bg-slate-100 dark:bg-white/5 rounded w-full mb-2" />
                <div className="h-4 bg-slate-100 dark:bg-white/5 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] text-center py-20 px-6">
            <div className="w-16 h-16 rounded-2xl bg-vovplan-500/10 border border-vovplan-500/20 flex items-center justify-center mx-auto mb-5">
              <MapIcon size={30} strokeWidth={1.5} className="text-vovplan-600" />
            </div>
            <h3 className="font-display text-xl font-bold text-strong mb-2">Пока нет проектов</h3>
            <p className="text-muted mb-6 max-w-sm mx-auto">
              Создайте первый проект — укажите координаты, и VOVPLAN подгрузит реальную местность.
            </p>
            <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-2">
              <Plus size={18} /> Создать проект
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
          error={createMutation.error?.message}
        />
      )}
    </div>
  );
}

/** «1 проект / 2 проекта / 5 проектов» */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ── Карточка проекта ──────────────────────────
function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const isArchived = project.status === 'ARCHIVED';
  const isMaster = project.myRole === 'MASTER';
  const open = () => navigate(`/projects/${project.id}`);

  return (
    <div
      className={`group relative rounded-2xl border overflow-hidden transition-all border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 hover:border-vovplan-300 dark:hover:border-vovplan-500/40 hover:shadow-lg hover:shadow-vovplan-500/5 hover:-translate-y-0.5 ${
        isArchived ? 'opacity-60' : ''
      }`}
    >
      {/* Превью сцены. Пока снимка нет — топографический градиент-заглушка,
          чтобы карточки не выглядели пустыми */}
      <button onClick={open} className="block w-full text-left" aria-label={`Открыть проект ${project.name}`}>
        <div className="relative h-36 bg-gradient-to-br from-vovplan-500/15 via-violet-500/10 to-cyan-500/15 dark:from-vovplan-500/20 dark:via-violet-500/10 dark:to-cyan-500/20">
          {project.previewUrl ? (
            <img src={project.previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-vovplan-500/40 dark:text-vovplan-300/30">
              <MapIcon size={38} strokeWidth={1.2} />
            </div>
          )}
          {isArchived && (
            <span className="absolute top-2.5 left-2.5 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-900/70 text-white">
              В архиве
            </span>
          )}
        </div>
      </button>

      {/* Шестерёнка — только владельцу: остальным действия запрещены сервером */}
      {isMaster && (
        <div className="absolute top-2.5 right-2.5 z-10">
          <div className="rounded-lg backdrop-blur bg-white/80 dark:bg-slate-900/70">
            <ProjectCardMenu project={project} />
          </div>
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          {/* Значок проекта */}
          {project.iconUrl ? (
            <img src={project.iconUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
          ) : (
            <span className="w-9 h-9 rounded-lg shrink-0 bg-gradient-to-br from-vovplan-500 via-violet-500 to-cyan-500 flex items-center justify-center text-white font-display text-sm font-bold">
              {project.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <button onClick={open} className="flex-1 min-w-0 text-left">
            <h3 className="text-lg font-semibold text-strong tracking-tight truncate group-hover:text-vovplan-700 dark:group-hover:text-vovplan-300 transition-colors">
              {project.name}
            </h3>
          </button>
          {project.myRole && (
            <span className="text-xs px-2 py-1 bg-vovplan-500/10 text-vovplan-700 border border-vovplan-500/20 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:border-vovplan-500/30 rounded-full font-medium whitespace-nowrap shrink-0">
              {ROLE_LABELS[project.myRole]}
            </span>
          )}
        </div>

        <button onClick={open} className="block w-full text-left">
          <p className="text-sm text-muted mb-5 line-clamp-2 min-h-[2.5rem]">
            {project.description || 'Без описания'}
          </p>
          <div className="flex items-center flex-wrap text-xs text-slate-500 dark:text-slate-400 gap-x-3 gap-y-1.5 pt-3 border-t border-slate-100 dark:border-white/5">
            <span className="flex items-center gap-1 font-mono">
              <MapPin size={12} className="text-slate-400 dark:text-slate-500" />
              {project.centerLat.toFixed(4)}, {project.centerLng.toFixed(4)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={12} className="text-slate-400 dark:text-slate-500" />
              {new Date(project.createdAt).toLocaleDateString('ru-RU')}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Модалка создания ──────────────────────────
function CreateProjectModal({
  onClose,
  onCreate,
  isLoading,
  error,
}: {
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description?: string;
    centerLat: number;
    centerLng: number;
    bounds: { north: number; south: number; east: number; west: number };
  }) => void;
  isLoading: boolean;
  error?: string;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [centerLat, setCenterLat] = useState('55.7558');
  const [centerLng, setCenterLng] = useState('37.6173');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(centerLat);
    const lng = parseFloat(centerLng);
    const delta = 0.01; // ~1km radius
    onCreate({
      name,
      description: description || undefined,
      centerLat: lat,
      centerLng: lng,
      bounds: { north: lat + delta, south: lat - delta, east: lng + delta, west: lng - delta },
    });
  };

  const field =
    'w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/60 border border-slate-300 dark:border-white/10 text-strong placeholder-slate-400 rounded-xl ' +
    'shadow-sm focus:outline-none focus:ring-2 focus:ring-vovplan-500/40 focus:border-vovplan-500 transition';
  const label = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900/60 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl font-bold text-strong tracking-tight mb-5">Новый проект</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="p-name" className={label}>Название *</label>
            <input
              id="p-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
              placeholder="Фестиваль «Лето 2026»"
            />
          </div>
          <div>
            <label htmlFor="p-desc" className={label}>Описание</label>
            <textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
              rows={3}
              placeholder="Краткое описание проекта"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="p-lat" className={label}>Широта</label>
              <input
                id="p-lat"
                required
                type="number"
                step="0.0001"
                value={centerLat}
                onChange={(e) => setCenterLat(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-lng" className={label}>Долгота</label>
              <input
                id="p-lng"
                required
                type="number"
                step="0.0001"
                value={centerLng}
                onChange={(e) => setCenterLng(e.target.value)}
                className={field}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Центр территории проекта. Границы установятся автоматически (~1 км радиус).
          </p>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl font-medium bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            >
              Отмена
            </button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1 py-2.5">
              {isLoading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
