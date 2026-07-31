import {
  Activity, Box, Wrench, MapPin, MessageCircle, Package, Mountain,
  UserPlus, UserMinus, EyeOff, RotateCcw, Trash2, Circle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { activityApi } from '../shared/api';
import type { ActivityEventPayload } from '../shared/api';
import { useRealtime } from '../features/collaboration/useRealtime';
import { usePresenceStore } from '../features/collaboration/presenceStore';
import { useAuthStore } from '../shared/authStore';

// Человекочитаемое описание + иконка действия
const ACTIONS: Record<string, { verb: string; icon: React.ReactNode; tone: string }> = {
  'object.create':    { verb: 'разместил объект',      icon: <Box size={15} />,          tone: '#34d399' },
  'object.delete':    { verb: 'удалил объект',          icon: <Trash2 size={15} />,       tone: '#f87171' },
  'object.hide':      { verb: 'скрыл объект',           icon: <EyeOff size={15} />,       tone: '#fbbf24' },
  'object.restore':   { verb: 'восстановил объект',     icon: <RotateCcw size={15} />,    tone: '#34d399' },
  'utility.create':   { verb: 'добавил инж. сеть',      icon: <Wrench size={15} />,       tone: '#34d399' },
  'utility.delete':   { verb: 'удалил инж. сеть',       icon: <Trash2 size={15} />,       tone: '#f87171' },
  'annotation.create':{ verb: 'добавил аннотацию',      icon: <MapPin size={15} />,       tone: '#60a5fa' },
  'annotation.delete':{ verb: 'удалил аннотацию',       icon: <Trash2 size={15} />,       tone: '#f87171' },
  'comment.create':   { verb: 'оставил комментарий',    icon: <MessageCircle size={15} />,tone: '#60a5fa' },
  'comment.delete':   { verb: 'удалил комментарий',     icon: <Trash2 size={15} />,       tone: '#f87171' },
  'model.upload':     { verb: 'загрузил модель',        icon: <Package size={15} />,      tone: '#a78bfa' },
  'model.delete':     { verb: 'удалил модель',          icon: <Trash2 size={15} />,       tone: '#f87171' },
  'terrain.import':   { verb: 'импортировал ландшафт',  icon: <Mountain size={15} />,     tone: '#34d399' },
  'terrain.remove':   { verb: 'удалил ландшафт',        icon: <Mountain size={15} />,     tone: '#f87171' },
  'member.invite':    { verb: 'пригласил участника',    icon: <UserPlus size={15} />,     tone: '#34d399' },
  'member.remove':    { verb: 'удалил участника',       icon: <UserMinus size={15} />,    tone: '#f87171' },
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'только что';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ActivityPanel({ projectId }: { projectId: string }) {
  const userName = useAuthStore((s) => s.user?.displayName ?? s.user?.email ?? 'Гость');
  // Подключаем realtime здесь тоже — чтобы «кто онлайн» и лента жили и на этой вкладке
  useRealtime(projectId, userName);
  const peers = usePresenceStore((s) => s.peers);

  const { data, isLoading } = useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => activityApi.list(projectId),
  });
  const events = data?.data ?? [];

  // Уникальные онлайн-участники по userId
  const online = Array.from(new Map(peers.map((p) => [p.userId, p])).values());

  return (
    <div className="p-6 max-w-3xl mx-auto text-slate-700 dark:text-slate-200 h-full overflow-y-auto">
      <h2 className="text-xl font-semibold text-strong tracking-tight mb-1 flex items-center gap-2">
        <Activity size={20} className="text-vovplan-400" /> Активность проекта
      </h2>
      <p className="text-sm text-muted mb-5">Кто сейчас в проекте и что менялось — в реальном времени.</p>

      {/* Сейчас онлайн */}
      <div className="glass p-4 mb-4">
        <h3 className="hud-title mb-3">Сейчас онлайн · {online.length}</h3>
        {online.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Пока никого — вы единственный посетитель.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {online.map((p) => (
              <span key={p.userId} className="flex items-center gap-2 bg-white/5 rounded-full pl-1.5 pr-3 py-1">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-strong" style={{ background: p.color }}>
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-200">{p.name}</span>
                <Circle size={7} className="fill-emerald-400 text-emerald-400" />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Лента изменений */}
      <div className="glass p-4">
        <h3 className="hud-title mb-3">Лента изменений</h3>
        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">Загрузка...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">Изменений пока нет. Разместите объект или нарисуйте сеть — событие появится здесь.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e: ActivityEventPayload) => {
              const meta = ACTIONS[e.action] ?? { verb: e.action, icon: <Activity size={15} />, tone: '#94a3b8' };
              return (
                <li key={e.id} className="flex items-start gap-3 py-2 border-t border-white/5 first:border-0">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: meta.tone }}>{meta.icon}</span>
                  <div className="flex-1 min-w-0 text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{e.actorName}</span>
                    <span className="text-muted"> {meta.verb}</span>
                    {e.targetName && <span className="text-slate-600 dark:text-slate-300"> «{e.targetName}»</span>}
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 flex-shrink-0 whitespace-nowrap">{timeAgo(e.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
