import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../shared/authStore';
import { safeNext } from '../../shared/safeNext';

/** Уже вошёл — не показываем форму, а возвращаем туда, откуда пришёл. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [params] = useSearchParams();
  if (isAuthenticated) return <Navigate to={safeNext(params.get('next'))} replace />;
  return children;
}

/** Нужен вход: запоминаем текущий адрес, чтобы после логина вернуться. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loc = useLocation();
  if (!isAuthenticated) {
    const next = loc.pathname + loc.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}
