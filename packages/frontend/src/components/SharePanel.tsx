import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sharesApi, presetsApi } from '../shared/api';
import type { ShareLinkPayload } from '../shared/api';

interface SharePanelProps {
  projectId: string;
}

/**
 * Управление публичными share-ссылками (вкладка «Доступ», только MASTER).
 * Ссылка даёт доступ уровня External Spectator: внешний вид сцены,
 * без инженерных сетей, комментариев и редактирования.
 */
export default function SharePanel({ projectId }: SharePanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState('');
  const [expiresDays, setExpiresDays] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: sharesData } = useQuery({
    queryKey: ['shares', projectId],
    queryFn: () => sharesApi.list(projectId),
  });

  const { data: presetsData } = useQuery({
    queryKey: ['presets', projectId],
    queryFn: () => presetsApi.list(projectId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      sharesApi.create(projectId, {
        name: name.trim(),
        presetId: presetId || undefined,
        expiresDays: expiresDays ? Number(expiresDays) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares', projectId] });
      setName('');
      setPresetId('');
      setExpiresDays('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => sharesApi.remove(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shares', projectId] }),
  });

  const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

  const copy = async (link: ShareLinkPayload) => {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const links = sharesData?.data ?? [];
  const presets = presetsData?.data ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto text-slate-200">
      <h2 className="text-xl font-semibold mb-1">Публичный доступ</h2>
      <p className="text-sm text-slate-400 mb-5">
        Ссылки для внешних наблюдателей — без регистрации. Виден только внешний вид сцены:
        без инженерных сетей, комментариев и возможности редактирования.
      </p>

      {/* Создание ссылки */}
      <form
        className="bg-slate-800 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
      >
        <label className="flex-1 min-w-40 text-xs text-slate-400">
          Название
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Для подрядчика"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-sm text-white border border-slate-700 focus:border-vovplan-500 outline-none"
          />
        </label>

        <label className="text-xs text-slate-400">
          Стартовый вид
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-lg bg-slate-900 text-sm text-white border border-slate-700 outline-none"
          >
            <option value="">По умолчанию</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          Срок (дней)
          <input
            type="number"
            min={1}
            max={365}
            value={expiresDays}
            onChange={(e) => setExpiresDays(e.target.value)}
            placeholder="∞"
            className="mt-1 block w-24 px-3 py-2 rounded-lg bg-slate-900 text-sm text-white border border-slate-700 outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={!name.trim() || createMutation.isPending}
          className="px-4 py-2 rounded-lg bg-vovplan-600 hover:bg-vovplan-700 disabled:opacity-40 text-sm font-medium text-white"
        >
          Создать ссылку
        </button>
      </form>

      {/* Список ссылок */}
      {links.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">Ссылок пока нет</p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => {
            const expired = l.expiresAt && new Date(l.expiresAt) < new Date();
            return (
              <li key={l.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {l.name}
                    {expired && <span className="text-[10px] px-1.5 py-0.5 bg-red-900/60 text-red-300 rounded-full">истекла</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{shareUrl(l.token)}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {l.presetId
                      ? `Вид: ${presets.find((p) => p.id === l.presetId)?.name ?? '—'}`
                      : 'Вид по умолчанию'}
                    {' · '}
                    {l.expiresAt ? `до ${new Date(l.expiresAt).toLocaleDateString()}` : 'бессрочная'}
                  </div>
                </div>
                <button
                  onClick={() => copy(l)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white shrink-0"
                >
                  {copiedId === l.id ? '✓ Скопировано' : 'Копировать'}
                </button>
                <button
                  onClick={() => removeMutation.mutate(l.id)}
                  className="px-3 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-800 text-xs text-red-200 shrink-0"
                  title="Отозвать ссылку — перестанет открываться"
                >
                  Отозвать
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
