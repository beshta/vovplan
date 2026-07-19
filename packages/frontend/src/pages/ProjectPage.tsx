import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { ROLE_LABELS } from '@vovplan/shared';
import { Viewer3D } from '../features/viewer3d';
import MembersPanel from '../components/MembersPanel';
import SharePanel from '../components/SharePanel';

type Tab = 'viewer' | 'members' | 'share' | 'settings';

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
      <div className="flex items-center justify-center h-screen">
        <div className="inline-block w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        Проект не найден
      </div>
    );
  }

  const isMaster = project.myRole === 'MASTER';

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Top bar */}
      <header className="bg-slate-950 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-white transition-colors shrink-0"
            title="К проектам"
          >
            <span className="hidden md:inline">← Проекты</span>
            <span className="md:hidden">←</span>
          </button>
          <div className="h-5 w-px bg-slate-700 shrink-0" />
          <h1 className="text-base md:text-lg font-semibold truncate">{project.name}</h1>
          {project.myRole && (
            <span className="hidden md:inline text-xs px-2 py-0.5 bg-vovplan-600/30 text-vovplan-200 rounded-full shrink-0">
              {ROLE_LABELS[project.myRole]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto shrink-0 max-w-[60vw]">
          <button
            onClick={() => setTab('viewer')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'viewer' ? 'bg-vovplan-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            3D-сцена
          </button>
          <button
            onClick={() => setTab('members')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'members' ? 'bg-vovplan-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Участники
          </button>
          {isMaster && (
            <button
              onClick={() => setTab('share')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'share' ? 'bg-vovplan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Доступ
            </button>
          )}
          {isMaster && (
            <button
              onClick={() => setTab('settings')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === 'settings' ? 'bg-vovplan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Настройки
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'viewer' && (
          <Viewer3D projectId={project.id} role={project.myRole!} userId={user!.id} />
        )}
        {tab === 'members' && <MembersPanel projectId={project.id} isMaster={isMaster} />}
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
  return (
    <div className="p-6 max-w-2xl mx-auto text-slate-200">
      <h2 className="text-xl font-semibold mb-4">Настройки проекта</h2>
      <div className="bg-slate-800 rounded-xl p-4 space-y-3 text-sm">
        <div>
          <span className="text-slate-400">ID:</span> {projectId}
        </div>
        <div>
          <span className="text-slate-400">Координаты центра:</span> {project.centerLat}, {project.centerLng}
        </div>
        <div>
          <span className="text-slate-400">Статус:</span> {project.status}
        </div>
      </div>
    </div>
  );
}
