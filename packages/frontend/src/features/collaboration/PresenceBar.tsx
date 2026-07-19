import { usePresenceStore } from './presenceStore';

/** Initials from a display name / email. */
function initials(name: string): string {
  const clean = name.split('@')[0];
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Top-right bar showing users currently viewing the project (real-time presence).
 */
export default function PresenceBar({ currentUserId }: { currentUserId: string }) {
  const connected = usePresenceStore((s) => s.connected);
  const peers = usePresenceStore((s) => s.peers);

  // De-duplicate by userId (a user may have multiple tabs/sockets)
  const byUser = new Map<string, { name: string; color: string; self: boolean }>();
  for (const p of peers) {
    if (!byUser.has(p.userId)) {
      byUser.set(p.userId, { name: p.name, color: p.color, self: p.userId === currentUserId });
    }
  }
  const unique = Array.from(byUser.values());

  return (
    <div className="glass flex items-center gap-2 px-3 py-2">
      <span
        className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-500'}`}
        title={connected ? 'В сети' : 'Не подключено'}
      />
      <div className="flex -space-x-2">
        {unique.map((u, i) => (
          <div
            key={i}
            title={u.self ? `${u.name} (вы)` : u.name}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white ring-2 ring-slate-900"
            style={{ background: u.color }}
          >
            {initials(u.name)}
          </div>
        ))}
      </div>
      <span className="text-xs text-slate-400 ml-1">
        {unique.length} онлайн
      </span>
    </div>
  );
}
