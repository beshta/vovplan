import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MailCheck, MailX, Loader2 } from 'lucide-react';
import { authApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';

/**
 * Страница по ссылке из письма: подтверждает адрес.
 *
 * Вход не требуется — доказательством служит сам токен. Человек может открыть
 * письмо на телефоне, где в сервис не заходил, и это должно работать.
 */
export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>('wait');
  const [message, setMessage] = useState('');
  const refresh = useAuthStore((s) => s.init);
  // React в разработке монтирует дважды, а токен одноразовый: без защёлки
  // второй вызов гасил бы только что подтверждённую ссылку и показывал ошибку
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;

    authApi
      .verifyEmail(token.trim())
      .then(async () => {
        setState('ok');
        // Если человек уже вошёл в этой вкладке — обновим профиль,
        // чтобы полоска «подтвердите адрес» исчезла сразу
        await refresh().catch(() => {});
      })
      .catch((err: Error) => {
        setState('fail');
        setMessage(err.message);
      });
  }, [token, refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass max-w-md w-full text-center px-8 py-10">
        {state === 'wait' && (
          <>
            <Loader2 size={44} className="mx-auto mb-4 text-vovplan-500 animate-spin" strokeWidth={1.5} />
            <p className="text-muted">Проверяем ссылку…</p>
          </>
        )}

        {state === 'ok' && (
          <>
            <MailCheck size={44} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h1 className="text-xl font-semibold text-strong mb-2">Адрес подтверждён</h1>
            <p className="text-sm text-muted mb-6">
              Спасибо. Теперь на этот адрес можно приглашать вас в проекты.
            </p>
            <Link to="/" className="btn-primary text-sm">К проектам</Link>
          </>
        )}

        {state === 'fail' && (
          <>
            <MailX size={44} className="mx-auto mb-4 text-red-400" strokeWidth={1.5} />
            <h1 className="text-xl font-semibold text-strong mb-2">Ссылка не подошла</h1>
            <p className="text-sm text-muted mb-6">{message}</p>
            <p className="text-xs text-muted mb-4">
              Такое бывает, если ссылка устарела или ей уже воспользовались.
              Войдите — и запросите письмо заново одной кнопкой.
            </p>
            <Link to="/login" className="btn-primary text-sm">Войти</Link>
          </>
        )}
      </div>
    </div>
  );
}
