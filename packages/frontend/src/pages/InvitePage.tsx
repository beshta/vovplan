import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type ProjectRole } from '@vovplan/shared';
import { invitesApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import AuthLayout, { authInput, authLabel } from './auth/AuthLayout';
import SocialButtons from './auth/SocialButtons';

/**
 * Приём приглашения. Гость регистрируется или входит прямо здесь — в том
 * числе через соцсеть. Кто уже вошёл, сразу принимается в проект: иначе
 * после Яндекса человек оказывался на этой странице ещё раз и думал, что
 * ссылка сломана.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, login, register } = useAuthStore();

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: info, isLoading, error: infoError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => invitesApi.info(token!),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (!isAuthenticated || !token || !info) return;
    let cancelled = false;
    setBusy(true);
    invitesApi
      .accept(token)
      .then((res) => {
        if (!cancelled) navigate(`/projects/${res.projectId}`, { replace: true });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token, info, navigate]);

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') await register(email, password, name);
      else await login(email, password);
      // Принятие — в эффекте, когда isAuthenticated станет true
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (infoError || !info) {
    const msg = infoError instanceof Error ? infoError.message : 'Приглашение недействительно';
    return (
      <AuthLayout
        title="Приглашение недоступно"
        subtitle={msg}
        footer={
          <Link to="/" className="text-vovplan-600 font-medium hover:underline">
            На главную
          </Link>
        }
      >
        <p className="text-sm text-muted">Попросите новую ссылку у того, кто вас приглашал.</p>
      </AuthLayout>
    );
  }

  const role = ROLE_LABELS[info.role as ProjectRole] ?? info.role;
  const next = token ? `/invite/${token}` : '/';

  if (isAuthenticated) {
    return (
      <AuthLayout
        title="Входим в проект"
        subtitle={`${info.projectName} · роль: ${role}`}
        footer={<span> </span>}
      >
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="text-sm text-muted">{busy ? 'Присоединяем…' : 'Секунду…'}</p>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Вас приглашают"
      subtitle={`${info.projectName} · роль: ${role}`}
      footer={
        <>
          Уже есть аккаунт? Переключитесь на вход — или зайдите через соцсеть.
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300 rounded-xl text-sm">
          {error}
        </div>
      )}

      <SocialButtons next={next} />

      <form onSubmit={handleAuth} className="space-y-4">
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl">
          {(['register', 'login'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === m ? 'bg-vovplan-600 text-white' : 'text-muted'
              }`}
            >
              {m === 'register' ? 'Регистрация' : 'Вход'}
            </button>
          ))}
        </div>
        {mode === 'register' && (
          <div>
            <label htmlFor="inv-name" className={authLabel}>Имя</label>
            <input
              id="inv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              placeholder="Ваше имя"
              className={authInput}
              autoComplete="name"
            />
          </div>
        )}
        <div>
          <label htmlFor="inv-email" className={authLabel}>Email</label>
          <input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className={authInput}
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="inv-password" className={authLabel}>Пароль</label>
          <input
            id="inv-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : 1}
            placeholder={mode === 'register' ? 'Минимум 8 символов' : 'Пароль'}
            className={authInput}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт и войти' : 'Войти в проект'}
        </button>
      </form>
    </AuthLayout>
  );
}
