import { useState } from 'react';
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
    <div className="min-h-screen bg-[#0b1020] bg-[radial-gradient(ellipse_60%_40%_at_50%_-10%,rgba(37,99,235,0.18),transparent)]">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-white">VOVPLAN</h1>
            <span className="text-xs text-slate-500 hidden sm:block">3D-платформа проектов</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">{user?.displayName}</span>
            <button onClick={logout} className="btn-ghost text-sm">
              Выйти
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white tracking-tight">Мои проекты</h2>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Создать проект
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-slate-500">Загрузка...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🗺️</div>
            <h3 className="text-lg font-medium text-slate-200 mb-2">Пока нет проектов</h3>
            <p className="text-slate-500 mb-4">Создайте первый проект, чтобы начать работу</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + Создать проект
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>

      {/* Create project modal */}
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

// ── Project Card ──────────────────────────────
function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      className="glass p-5 hover:bg-slate-800/80 hover:border-vovplan-500/40 hover:-translate-y-0.5 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-white tracking-tight">{project.name}</h3>
        {project.myRole && (
          <span className="text-xs px-2 py-1 bg-vovplan-600/20 text-vovplan-200 rounded-full font-medium whitespace-nowrap">
            {ROLE_LABELS[project.myRole]}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400 mb-4 line-clamp-2">
        {project.description || 'Без описания'}
      </p>
      <div className="flex items-center text-xs text-slate-500 gap-3">
        <span>📍 {project.centerLat.toFixed(4)}, {project.centerLng.toFixed(4)}</span>
        <span>•</span>
        <span>{new Date(project.createdAt).toLocaleDateString('ru-RU')}</span>
      </div>
    </div>
  );
}

// ── Create Project Modal ──────────────────────
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="glass p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-semibold text-white tracking-tight mb-4">Новый проект</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-500/15 border border-red-500/20 text-red-300 rounded-xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="input-label">Название *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Фестиваль «Лето 2026»" />
          </div>
          <div>
            <label className="input-label">Описание</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-field" rows={3} placeholder="Краткое описание проекта" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="input-label">Широта (Lat)</label>
              <input required type="number" step="0.0001" value={centerLat} onChange={(e) => setCenterLat(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="input-label">Долгота (Lng)</label>
              <input required type="number" step="0.0001" value={centerLng} onChange={(e) => setCenterLng(e.target.value)} className="input-field" />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Центр территории проекта. Границы установятся автоматически (~1км радиус).
          </p>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1">
              {isLoading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
