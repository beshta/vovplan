import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { ROLE_LABELS } from '@vovplan/shared';
import { Viewer3D } from '../features/viewer3d';
import MembersPanel from '../components/MembersPanel';
import SharePanel from '../components/SharePanel';
import ActivityPanel from '../components/ActivityPanel';
import SnapshotsPanel from '../components/SnapshotsPanel';

type Tab = 'viewer' | 'members' | 'activity' | 'versions' | 'share' | 'settings';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('viewer');

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b1020]">
        <div className="inline-block w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-screen bg-[#0b1020] text-slate-400">
        <p>Проект не найден</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          К проектам
        </button>
      </div>
    );
  }

  const isMaster = project.myRole === 'MASTER';

  // Вкладки списком — раньше шесть почти одинаковых блоков кнопок
  const tabs: { id: Tab; label: string; masterOnly?: boolean }[] = [
    { id: 'viewer', label: '3D-сцена' },
    { id: 'members', label: 'Участники' },
    { id: 'activity', label: 'Активность' },
    { id: 'versions', label: 'Версии' },
    { id: 'share', label: 'Доступ', masterOnly: true },
    { id: 'settings', label: 'Настройки', masterOnly: true },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#0b1020]">
      {/* Верхняя панель */}
      <header className="bg-[#0b1020]/90 backdrop-blur-xl border-b border-white/10 text-white px-4 h-14 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors shrink-0"
            title="К проектам"
          >
            <ArrowLeft size={16} />
            <span className="hidden md:inline">Проекты</span>
          </button>
          <div className="h-5 w-px bg-white/10 shrink-0" />
          <h1 className="text-base font-semibold tracking-tight truncate">{project.name}</h1>
          {project.myRole && (
            <span className="hidden md:inline text-xs px-2 py-0.5 bg-vovplan-500/15 text-vovplan-200 border border-vovplan-500/25 rounded-full shrink-0">
              {ROLE_LABELS[project.myRole]}
            </span>
          )}
        </div>

        {/* Сегментированный переключатель */}
        <nav className="flex items-center gap-0.5 p-1 rounded-xl bg-white/5 border border-white/10 overflow-x-auto shrink-0">
          {tabs
            .filter((t) => !t.masterOnly || isMaster)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  tab === t.id
                    ? 'bg-gradient-to-r from-vovplan-600 via-violet-500 to-cyan-500 text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
        </nav>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'viewer' && (
          <Viewer3D projectId={project.id} role={project.myRole!} userId={user!.id} />
        )}
        {tab === 'members' && <MembersPanel projectId={project.id} isMaster={isMaster} />}
        {tab === 'activity' && <ActivityPanel projectId={project.id} />}
        {tab === 'versions' && <SnapshotsPanel projectId={project.id} isMaster={isMaster} canEdit={project.myRole === 'MASTER' || project.myRole === 'DESIGNER'} />}
        {tab === 'share' && isMaster && <SharePanel projectId={project.id} />}
        {tab === 'settings' && isMaster && (
          <ProjectSettings projectId={project.id} project={project} />
        )}
      </div>
    </div>
  );
}

// ── Settings sub-component ────────────────────
function ProjectSettings({ projectId, project }: { projectId: string; project: any }) {
  const rows: [string, string][] = [
    ['ID проекта', projectId],
    ['Координаты центра', `${project.centerLat}, ${project.centerLng}`],
    ['Статус', project.status],
  ];
  return (
    <div className="p-6 max-w-2xl mx-auto text-slate-200 overflow-y-auto h-full">
      <h2 className="font-display text-xl font-bold tracking-tight mb-5">Настройки проекта</h2>
      <div className="glass divide-y divide-white/5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-slate-400">{k}</span>
            <span className="font-mono text-slate-200 truncate">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
