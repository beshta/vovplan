import { useEffect, useState, type ReactNode } from 'react';
import { API_URL } from '../../shared/api';
import { safeNext } from '../../shared/safeNext';

/**
 * Вторичный вход: ряд иконок под основной кнопкой формы.
 *
 * Так делают Linear, Notion, Figma: почта и пароль — главный путь,
 * соцсеть — тихий второй. Кнопки всегда на экране: иначе человек думает,
 * что соцсетей нет. Если ключей на сервере ещё нет — остаёмся на странице
 * и говорим об этом, а не уводим с приглашения на чужой логин.
 */

export type OAuthId = 'google' | 'yandex' | 'facebook' | 'vk' | 'wechat';
type SocialId = OAuthId | 'telegram';

const ORDER: SocialId[] = ['yandex', 'google', 'telegram', 'vk', 'facebook', 'wechat'];

const LABEL: Record<SocialId, string> = {
  yandex: 'Яндекс',
  google: 'Google',
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  facebook: 'Facebook',
  wechat: 'WeChat',
};

/** Официальные знаки сервисов: круг/сквиркл сам по себе, плитка кнопки белая. */

function IconYandex() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path fill="#FC3F1D" d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10z" />
      <path fill="#fff" d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.487H7.49l2.695-4.014c-1.55-1.111-2.42-2.19-2.42-4.015 0-2.288 1.595-3.85 4.62-3.85h3.003v11.868H13.32V7.666z" />
    </svg>
  );
}

function IconGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="h-[22px] w-[22px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg viewBox="0 0 240 240" className="h-7 w-7" aria-hidden>
      <defs>
        <linearGradient id="vovplan-tg" x1="120" y1="240" x2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1d93d2" />
          <stop offset="1" stopColor="#38b0e3" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r="120" fill="url(#vovplan-tg)" />
      <path fill="#c8daea" d="M81.229 128.772l14.237 39.406s1.78 3.687 3.686 3.687 30.255-29.492 30.255-29.492l31.525-60.89L81.737 118.6Z" />
      <path fill="#a9c6d8" d="M100.106 138.878l-2.733 29.046s-1.144 8.9 7.754 0 17.415-15.763 17.415-15.763" />
      <path fill="#fff" d="M81.486 130.178 52.2 120.636s-3.5-1.42-2.373-4.64c.232-.664.7-1.229 2.1-2.2 6.489-4.523 120.106-45.36 120.106-45.36s3.208-1.081 5.1-.362a2.766 2.766 0 0 1 1.885 2.055 9.357 9.357 0 0 1 .254 2.585c-.009.752-.1 1.449-.169 2.542-.692 11.165-21.4 94.493-21.4 94.493s-1.239 4.876-5.678 5.043A8.13 8.13 0 0 1 146.1 172.5c-8.711-7.493-38.819-27.727-45.472-32.177a1.27 1.27 0 0 1-.546-.9c-.093-.469.417-1.05.417-1.05s52.426-46.6 53.821-51.492c.108-.379-.3-.566-.848-.4-3.482 1.281-63.844 39.4-70.506 43.607A3.21 3.21 0 0 1 81.486 130.178Z" />
    </svg>
  );
}

function IconVk() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path
        fill="#0077FF"
        d="m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z"
      />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden>
      <defs>
        <linearGradient id="vovplan-fb" x1="20" y1="40" x2="20" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0062E0" />
          <stop offset="1" stopColor="#19AFFF" />
        </linearGradient>
      </defs>
      <path fill="url(#vovplan-fb)" d="M16.7 39.8C7.2 38.1 0 29.9 0 20 0 9 9 0 20 0s20 9 20 20c0 9.9-7.2 18.1-16.7 19.8l-1.1-.9h-4.4z" />
      <path fill="#fff" d="M27.8 25.6l.9-5.6h-5.3v-3.9c0-1.6.6-2.8 3-2.8h2.6V8.2c-1.4-.2-3-.4-4.4-.4-4.6 0-7.8 2.8-7.8 7.8V20h-5v5.6h5v14.1c1.1.2 2.2.3 3.3.3 1.1 0 2.2-.1 3.3-.3V25.6h4.4z" />
    </svg>
  );
}

function IconWeChat() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden>
      <path
        fill="#07C160"
        d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"
      />
    </svg>
  );
}

const ICONS: Record<SocialId, ReactNode> = {
  yandex: <IconYandex />,
  google: <IconGoogle />,
  telegram: <IconTelegram />,
  vk: <IconVk />,
  facebook: <IconFacebook />,
  wechat: <IconWeChat />,
};

export default function SocialButtons({
  next = '/',
  className = '',
}: {
  next?: string;
  className?: string;
}) {
  const dest = safeNext(next);
  const [enabled, setEnabled] = useState<OAuthId[]>([]);
  const [telegramOn, setTelegramOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/auth/oauth/providers`)
      .then((r) => r.json())
      .then((body: { providers?: OAuthId[]; telegram?: { username: string } | null }) => {
        if (cancelled) return;
        const on = new Set(body.providers ?? []);
        setEnabled(ORDER.filter((id): id is OAuthId => id !== 'telegram' && on.has(id)));
        setTelegramOn(Boolean(body.telegram?.username));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOn = (id: SocialId) => (id === 'telegram' ? telegramOn : enabled.includes(id));

  const start = (id: SocialId) => {
    if (loaded && !isOn(id)) {
      setError(`Вход через ${LABEL[id]} ещё не подключён на сервере. Пока зайдите по почте — или через другую кнопку.`);
      return;
    }
    setError('');
    const q = new URLSearchParams({ next: dest });
    const path = id === 'telegram' ? '/api/auth/telegram/start' : `/api/auth/oauth/${id}`;
    window.location.href = `${API_URL}${path}?${q.toString()}`;
  };

  return (
    <div className={`pt-5 ${className}`.trim()}>
      <p className="text-center text-xs text-muted mb-3">Войти через</p>
      <div className="flex items-center justify-center gap-2.5">
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => start(id)}
            aria-label={`Войти через ${LABEL[id]}`}
            title={`Войти через ${LABEL[id]}`}
            className={`h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl flex items-center justify-center bg-white ring-1 ring-slate-200/90 shadow-sm transition hover:scale-[1.05] hover:shadow-md hover:bg-slate-50 active:scale-95 dark:bg-white ${
              loaded && !isOn(id) ? 'opacity-55' : ''
            }`}
          >
            {ICONS[id]}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
