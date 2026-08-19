import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../../shared/api';
import { useAuthStore } from '../../shared/authStore';

/**
 * Кнопки быстрого входа. Рисуются только те, для которых на сервере есть ключи:
 * иначе человек жмёт «Яндекс» и получает чужую страницу ошибки.
 *
 * Telegram — виджет, не редирект: подпись проверяет наш бэкенд, токен бота
 * на фронт не попадает.
 */

export type OAuthId = 'google' | 'yandex' | 'facebook' | 'vk' | 'wechat';

const ORDER: OAuthId[] = ['yandex', 'google', 'vk', 'facebook', 'wechat'];

const TITLE: Record<OAuthId, string> = {
  yandex: 'Войти через Яндекс',
  google: 'Войти через Google',
  facebook: 'Войти через Facebook',
  vk: 'Войти через ВКонтакте',
  wechat: 'Войти через WeChat',
};

const STYLE: Record<OAuthId, string> = {
  yandex: 'bg-[#FC3F1D] text-white hover:brightness-110',
  google: 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-white',
  facebook: 'bg-[#1877F2] text-white hover:brightness-110',
  vk: 'bg-[#0077FF] text-white hover:brightness-110',
  wechat: 'bg-[#07C160] text-white hover:brightness-110',
};

export default function SocialButtons({ next = '/' }: { next?: string }) {
  const [providers, setProviders] = useState<OAuthId[]>([]);
  const [telegram, setTelegram] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/auth/oauth/providers`)
      .then((r) => r.json())
      .then((body: { providers?: OAuthId[]; telegram?: { username: string } | null }) => {
        if (cancelled) return;
        setProviders(ORDER.filter((id) => body.providers?.includes(id)));
        setTelegram(body.telegram?.username ?? null);
      })
      .catch(() => {
        /* нет кнопок — остаётся обычная форма */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = (id: OAuthId) => {
    const q = new URLSearchParams({ next });
    window.location.href = `${API_URL}/api/auth/oauth/${id}?${q.toString()}`;
  };

  const beforeTg = providers.filter((id) => id === 'yandex' || id === 'google');
  const afterTg = providers.filter((id) => id === 'vk' || id === 'facebook' || id === 'wechat');

  if (providers.length === 0 && !telegram) return null;

  const button = (id: OAuthId) => (
    <button
      key={id}
      type="button"
      onClick={() => start(id)}
      className={`w-full py-2.5 rounded-xl text-sm font-medium transition ${STYLE[id]}`}
    >
      {TITLE[id]}
    </button>
  );

  return (
    <div className="space-y-3 mb-6">
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {beforeTg.length > 0 && <div className="grid gap-2">{beforeTg.map(button)}</div>}
      {telegram && <TelegramWidget username={telegram} next={next} onError={setError} />}
      {afterTg.length > 0 && <div className="grid gap-2">{afterTg.map(button)}</div>}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
        или по почте
        <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
      </div>
    </div>
  );
}

function TelegramWidget({
  username,
  next,
  onError,
}: {
  username: string;
  next: string;
  onError: (msg: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const acceptToken = useAuthStore((s) => s.acceptToken);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const handler = async (user: Record<string, unknown>) => {
      try {
        const res = await fetch(`${API_URL}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...user, next }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? 'Telegram не принял вход');
        await acceptToken(body.accessToken);
        navigate(typeof body.next === 'string' ? body.next : next, { replace: true });
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Не удалось войти через Telegram');
      }
    };

    (window as unknown as { onVovplanTelegramAuth: typeof handler }).onVovplanTelegramAuth = handler;

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', username);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-lang', 'ru');
    script.setAttribute('data-onauth', 'onVovplanTelegramAuth(user)');
    el.innerHTML = '';
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [username, next, acceptToken, navigate, onError]);

  return <div className="flex justify-center" ref={host} />;
}
