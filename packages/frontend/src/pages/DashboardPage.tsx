import { useState } from 'react';
import { Map as MapIcon, MapPin, Plus, LogOut, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { ROLE_LABELS, type Project } from '@vovplan/shared';

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
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
    },
  });

  const projects = projectsData?.data ?? [];

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
      {/* ── Шапка ── */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-white/70 border-b border-slate-900/5">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-bold tracking-wide text-slate-900">VOVPLAN</span>
            <span className="text-xs text-slate-500 hidden sm:block">3D-платформа проектов</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 hidden sm:block">{user?.displayName}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <LogOut size={15} /> Выйти
            </button>
          </div>
        </div>
      </header>

      {/* ── Контент ── */}
      <main className="max-w-7xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">Мои проекты</h1>
            <p className="text-slate-600 mt-1.5">
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
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 animate-pulse">
                <div className="h-5 bg-slate-200 rounded w-2/3 mb-3" />
                <div className="h-4 bg-slate-100 rounded w-full mb-2" />
                <div className="h-4 bg-slate-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 text-center py-20 px-6">
            <div className="w-16 h-16 rounded-2xl bg-vovplan-500/10 border border-vovplan-500/20 flex items-center justify-center mx-auto mb-5">
              <MapIcon size={30} strokeWidth={1.5} className="text-vovplan-600" />
            </div>
            <h3 className="font-display text-xl font-bold text-slate-900 mb-2">Пока нет проектов</h3>
            <p className="text-slate-600 mb-6 max-w-sm mx-auto">
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
  return (
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-vovplan-300 hover:shadow-lg hover:shadow-vovplan-500/5 hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold text-slate-900 tracking-tight group-hover:text-vovplan-700 transition-colors">
          {project.name}
        </h3>
        {project.myRole && (
          <span className="text-xs px-2 py-1 bg-vovplan-500/10 text-vovplan-700 border border-vovplan-500/20 rounded-full font-medium whitespace-nowrap shrink-0">
            {ROLE_LABELS[project.myRole]}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 mb-5 line-clamp-2 min-h-[2.5rem]">
        {project.description || 'Без описания'}
      </p>
      <div className="flex items-center flex-wrap text-xs text-slate-500 gap-x-3 gap-y-1.5 pt-3 border-t border-slate-100">
        <span className="flex items-center gap-1 font-mono">
          <MapPin size={12} className="text-slate-400" />
          {project.centerLat.toFixed(4)}, {project.centerLng.toFixed(4)}
        </span>
        <span className="flex items-center gap-1">
          <Calendar size={12} className="text-slate-400" />
          {new Date(project.createdAt).toLocaleDateString('ru-RU')}
        </span>
      </div>
    </button>
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
    'w-full px-3.5 py-2.5 bg-white border border-slate-300 text-slate-900 placeholder-slate-400 rounded-xl ' +
    'shadow-sm focus:outline-none focus:ring-2 focus:ring-vovplan-500/40 focus:border-vovplan-500 transition';
  const label = 'block text-sm font-medium text-slate-700 mb-1.5';

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl font-bold text-slate-900 tracking-tight mb-5">Новый проект</h3>

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
          <p className="text-xs text-slate-500">
            Центр территории проекта. Границы установятся автоматически (~1 км радиус).
          </p>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
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
