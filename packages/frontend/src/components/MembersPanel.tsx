import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../shared/api';
import { ROLE_LABELS, ProjectRole } from '@vovplan/shared';

const ROLE_OPTIONS = [ProjectRole.DESIGNER, ProjectRole.SUPER_SPECTATOR, ProjectRole.SPECTATOR, ProjectRole.EXTERNAL_SPECTATOR];

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
    <div className="p-6 max-w-3xl mx-auto text-slate-200">
      <h2 className="text-xl font-semibold mb-4">Участники проекта</h2>

      {/* Invite form */}
      {isMaster && (
        <div className="bg-slate-800 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Пригласить участника</h3>
          {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-vovplan-500"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={!inviteEmail || inviteMutation.isPending}
              className="px-4 py-2 bg-vovplan-600 text-white rounded-lg text-sm font-medium hover:bg-vovplan-700 disabled:opacity-50"
            >
              Добавить
            </button>
          </div>
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <div className="text-slate-400">Загрузка...</div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-vovplan-600 flex items-center justify-center text-sm font-bold text-white">
                  {m.user.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-white">{m.user.displayName}</div>
                  <div className="text-xs text-slate-400">{m.user.id === m.userId ? '' : ''}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isMaster && m.role !== 'MASTER' ? (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => roleMutation.mutate({ userId: m.userId, role: e.target.value })}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMutation.mutate(m.userId)}
                      className="px-2 py-1 text-red-400 hover:text-red-300 text-sm"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span className="text-xs px-2 py-1 bg-vovplan-600/20 text-vovplan-200 rounded-full">
                    {ROLE_LABELS[m.role as ProjectRole]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
