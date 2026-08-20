import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../shared/authStore';
import AuthLayout, { authInput, authLabel } from './auth/AuthLayout';
import SocialButtons from './auth/SocialButtons';
import { track } from '../shared/analytics';
import { safeNext } from '../shared/safeNext';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const oauthError = params.get('error');
  const next = safeNext(params.get('next'));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      track('login.done');
      navigate(next);
    } catch {
      /* error is in store */
    }
  };

  return (
    <AuthLayout
      title="Вход в аккаунт"
      subtitle="Продолжите работу над проектами."
      footer={
        <>
          Нет аккаунта?{' '}
          <Link to={next !== '/' ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="text-vovplan-600 font-medium hover:underline">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      {(error || oauthError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300 rounded-xl text-sm">
          {error || oauthError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <button type="submit" disabled={isLoading} className="btn-primary w-full py-2.5">
          {isLoading ? 'Вход...' : 'Войти'}
        </button>
      </form>

      <SocialButtons next={next} />

      {/* После основной кнопки и соцсетей: ищут её после неудачной попытки войти */}
      <p className="mt-5 text-center text-sm">
        <Link to="/forgot" className="text-muted hover:text-vovplan-600 hover:underline">
          Забыли пароль?
        </Link>
      </p>
    </AuthLayout>
  );
}
