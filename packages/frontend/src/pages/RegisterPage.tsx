import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../shared/authStore';
import AuthLayout, { authInput, authLabel } from './auth/AuthLayout';
import SocialButtons from './auth/SocialButtons';
import { track } from '../shared/analytics';
import { safeNext } from '../shared/safeNext';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { register, isLoading, error, clearError } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const next = safeNext(params.get('next'));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    track('register.start');
    try {
      await register(email, password, displayName);
      track('register.done');
      navigate(next);
    } catch {
      /* error is in store */
    }
  };

  return (
    <AuthLayout
      title="Создать аккаунт"
      subtitle="Через соцсеть — в один клик. Или почта и пароль, как обычно."
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link to={next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="text-vovplan-600 font-medium hover:underline">
            Войти
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300 rounded-xl text-sm">
          {error}
        </div>
      )}

      <SocialButtons next={next} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className={authLabel}>Имя</label>
          <input
            id="name"
            type="text"
            required
            minLength={2}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={authInput}
            placeholder="Ваше имя"
            autoComplete="name"
          />
        </div>

        <div>
          <label htmlFor="email" className={authLabel}>Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div>
          <label htmlFor="password" className={authLabel}>Пароль</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
            placeholder="Минимум 8 символов"
            autoComplete="new-password"
          />
          <p className="mt-1.5 text-xs text-muted">Минимум 8 символов</p>
        </div>

        <button type="submit" disabled={isLoading} className="btn-primary w-full py-2.5">
          {isLoading ? 'Создание...' : 'Создать аккаунт'}
        </button>
      </form>
    </AuthLayout>
  );
}
