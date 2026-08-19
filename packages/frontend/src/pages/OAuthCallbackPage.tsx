import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../shared/authStore';
import { safeNext } from '../shared/safeNext';

/**
 * Возврат из Яндекса / Google / VK / Facebook / WeChat.
 * Токен в query — чтобы редирект с бэкенда мог его передать (hash в Location
 * часть браузеров отрезает). Сразу вычищаем из адресной строки.
 */
export default function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const acceptToken = useAuthStore((s) => s.acceptToken);
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const token = params.get('accessToken');
    const next = safeNext(params.get('next'));
    if (!token) {
      setError('Нет токена входа. Попробуйте ещё раз.');
      return;
    }
    started.current = true;
    window.history.replaceState({}, document.title, '/auth/oauth');
    void acceptToken(token)
      .then(() => {
        navigate(next, { replace: true });
      })
      .catch((err: Error) => {
        setError(err.message || 'Не удалось войти');
      });
  }, [params, acceptToken, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>
          <a href={`/login?next=${encodeURIComponent(safeNext(params.get('next')))}`} className="btn-primary text-sm">Ко входу</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center text-muted text-sm">
      Входим…
    </div>
  );
}
