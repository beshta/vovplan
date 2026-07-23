import { useState } from 'react';
import { UserPlus, X, ShieldCheck, Check, Minus, Info } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { ROLE_LABELS, ProjectRole } from '@vovplan/shared';

const ROLE_OPTIONS = [ProjectRole.DESIGNER, ProjectRole.SUPER_SPECTATOR, ProjectRole.SPECTATOR, ProjectRole.EXTERNAL_SPECTATOR];

// Матрица прав для наглядности (что доступно каждой роли)
const CAPS = [
  { key: 'Просмотр сцены',        roles: ['MASTER', 'DESIGNER', 'SUPER_SPECTATOR', 'SPECTATOR', 'EXTERNAL_SPECTATOR'] },
  { key: 'Комментарии',            roles: ['MASTER', 'DESIGNER', 'SUPER_SPECTATOR', 'SPECTATOR'] },
  { key: 'Инж. сети (X-Ray)',      roles: ['MASTER', 'DESIGNER', 'SUPER_SPECTATOR'] },
  { key: 'Загрузка/правка моделей', roles: ['MASTER', 'DESIGNER'] },
  { key: 'Управление участниками', roles: ['MASTER'] },
] as const;
const ROLE_COLS: ProjectRole[] = [
  ProjectRole.MASTER, ProjectRole.DESIGNER, ProjectRole.SUPER_SPECTATOR, ProjectRole.SPECTATOR, ProjectRole.EXTERNAL_SPECTATOR,
];
const ROLE_SHORT: Record<string, string> = {
  MASTER: 'Мст', DESIGNER: 'Прж', SUPER_SPECTATOR: 'С-зр', SPECTATOR: 'Зр', EXTERNAL_SPECTATOR: 'Вн',
};

function roleColor(role: string): string {
  return {
    MASTER: '#2563eb', DESIGNER: '#8b5cf6', SUPER_SPECTATOR: '#10b981',
    SPECTATOR: '#f59e0b', EXTERNAL_SPECTATOR: '#64748b',
  }[role] ?? '#64748b';
}

export default function MembersPanel({ projectId, isMaster }: { projectId: string; isMaster: boolean }) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('SPECTATOR');
  const [error, setError] = useState('');

  const { data: membersData, isLoading } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => projectsApi.listMembers(projectId),
  });

  const inviteMutation = useMutation({
    mutationFn: () => projectsApi.inviteMember(projectId, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', projectId] });
      setInviteEmail('');
      setError('');
    },
    onError: (err: any) => setError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(projectId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', projectId] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      projectsApi.updateMemberRole(projectId, userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', projectId] }),
  });

  const members = membersData?.data ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto text-slate-200 h-full overflow-y-auto">
      <h2 className="text-xl font-semibold text-white tracking-tight mb-1 flex items-center gap-2">
        <ShieldCheck size={20} className="text-vovplan-400" /> Доступ к проекту
      </h2>
      <p className="text-sm text-slate-400 mb-5">Приглашайте участников и назначайте роли. Права каждой роли — в таблице ниже.</p>

      {/* Invite form */}
      {isMaster && (
        <div className="glass p-4 mb-4">
          <h3 className="hud-title mb-3 flex items-center gap-1.5"><UserPlus size={14} /> Пригласить участника</h3>
          {error && <div className="mb-3 text-sm text-red-300 bg-red-500/15 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="input-field flex-1 min-w-52 text-sm"
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="input-field text-sm w-auto">
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={!inviteEmail || inviteMutation.isPending}
              className="btn-primary text-sm"
            >
              Пригласить
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
            <Info size={12} /> Пользователь должен быть зарегистрирован в VOVPLAN под этим email.
          </p>
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <div className="text-slate-400 text-sm py-4">Загрузка...</div>
      ) : (
        <div className="space-y-2 mb-6">
          {members.map((m) => (
            <div key={m.id} className="glass px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ background: roleColor(m.role) }}
                >
                  {m.user.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{m.user.displayName}</div>
                  <div className="text-xs text-slate-500">{ROLE_LABELS[m.role as ProjectRole]}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isMaster && m.role !== 'MASTER' ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => roleMutation.mutate({ userId: m.userId, role: e.target.value })}
                      className="input-field text-xs py-1.5 w-auto"
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <button
                      onClick={() => removeMutation.mutate(m.userId)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1"
                      title="Удалить из проекта"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: `${roleColor(m.role)}33`, color: roleColor(m.role) }}>
                    {ROLE_LABELS[m.role as ProjectRole]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Матрица прав по ролям */}
      <div className="glass p-4">
        <h3 className="hud-title mb-3">Права ролей</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left font-normal text-slate-500 pb-2 pr-2">Возможность</th>
                {ROLE_COLS.map((r) => (
                  <th key={r} className="pb-2 px-1.5 font-medium" title={ROLE_LABELS[r]}>
                    <span style={{ color: roleColor(r) }}>{ROLE_SHORT[r]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((cap) => (
                <tr key={cap.key} className="border-t border-white/5">
                  <td className="py-1.5 pr-2 text-slate-300">{cap.key}</td>
                  {ROLE_COLS.map((r) => (
                    <td key={r} className="text-center py-1.5 px-1.5">
                      {(cap.roles as readonly string[]).includes(r)
                        ? <Check size={14} className="inline text-emerald-400" />
                        : <Minus size={14} className="inline text-slate-700" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Мст — Мастер, Прж — Проектировщик, С-зр — Супер-зритель, Зр — Зритель, Вн — Внешний зритель.
        </p>
      </div>
    </div>
  );
}
