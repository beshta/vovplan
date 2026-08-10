import { useState } from 'react';
import ProjectSettings from './ProjectSettings';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  // ?tab= — переходы из меню карточки проекта («Доступы», «История изменений»)
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(
    initialTab && ['viewer', 'members', 'activity', 'versions', 'share', 'settings'].includes(initialTab)
      ? initialTab
      : 'viewer',
  );

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen surface-page">
        <div className="inline-block w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-screen surface-page text-muted">
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
    <div className="h-screen flex flex-col surface-page">
      {/* Верхняя панель */}
      <header className="border-b surface-bar px-4 h-14 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-strong transition-colors shrink-0"
            title="К проектам"
          >
            <ArrowLeft size={16} />
            <span className="hidden md:inline">Проекты</span>
          </button>
          <div className="h-5 w-px bg-slate-900/10 dark:bg-white/10 shrink-0" />
          <h1 className="text-base font-semibold tracking-tight truncate text-strong">{project.name}</h1>
          {project.myRole && (
            <span className="hidden md:inline text-xs px-2 py-0.5 bg-vovplan-500/10 text-vovplan-700 border border-vovplan-500/20 dark:bg-vovplan-500/15 dark:text-vovplan-200 dark:border-vovplan-500/25 rounded-full shrink-0">
              {ROLE_LABELS[project.myRole]}
            </span>
          )}
        </div>

        {/* Сегментированный переключатель */}
        <nav className="flex items-center gap-0.5 p-1 rounded-xl bg-slate-900/5 border border-slate-900/10 dark:bg-white/5 dark:border-white/10 overflow-x-auto shrink-0">
          {tabs
            .filter((t) => !t.masterOnly || isMaster)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  tab === t.id
                    ? 'bg-gradient-to-r from-vovplan-600 via-violet-500 to-cyan-500 text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)]'
                    : 'text-muted hover:text-strong hover:bg-slate-900/5 dark:hover:bg-white/5'
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
