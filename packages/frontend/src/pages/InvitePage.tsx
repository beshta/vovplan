import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type ProjectRole } from '@vovplan/shared';
import { invitesApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';

/**
 * Приём приглашения по ссылке (/invite/:token).
 * Если пользователь не вошёл — форма входа/регистрации прямо здесь;
 * после авторизации приглашение принимается и открывается проект.
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

  const accept = async () => {
    const res = await invitesApi.accept(token!);
    navigate(`/projects/${res.projectId}`);
  };

  const handleAuthAndAccept = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') await register(email, password, name);
      else await login(email, password);
      await accept();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    setError('');
    try {
      await accept();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (isLoading) {
    return <Centered><div className="inline-block w-10 h-10 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" /></Centered>;
  }

  if (infoError || !info) {
    const msg = infoError instanceof Error ? infoError.message : 'Приглашение недействительно';
    return (
      <Centered>
        <div className="glass p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-3">🔗</div>
          <h1 className="text-lg font-semibold text-white mb-1">Приглашение недоступно</h1>
          <p className="text-sm text-slate-400">{msg}</p>
          <button onClick={() => navigate('/')} className="btn-secondary mt-5 text-sm">На главную</button>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="font-display text-3xl font-bold text-white tracking-wide">VOVPLAN</h1>
        </div>
        <div className="glass p-8">
          <p className="text-sm text-slate-400">Вас приглашают в проект</p>
          <h2 className="text-xl font-semibold text-white tracking-tight mt-1">{info.projectName}</h2>
          <span className="inline-block mt-2 text-xs px-2.5 py-1 bg-vovplan-500/10 text-vovplan-700 dark:bg-vovplan-600/20 dark:text-vovplan-200 rounded-full font-medium">
            роль: {ROLE_LABELS[info.role as ProjectRole]}
          </span>

          {error && <div className="mt-4 p-3 bg-red-500/15 border border-red-500/20 text-red-300 rounded-xl text-sm">{error}</div>}

          {isAuthenticated ? (
            <button onClick={handleJoin} disabled={busy} className="btn-primary w-full mt-6">
              {busy ? 'Присоединение…' : 'Присоединиться к проекту'}
            </button>
          ) : (
            <form onSubmit={handleAuthAndAccept} className="mt-5 space-y-3">
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
                {(['register', 'login'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-vovplan-600 text-white' : 'text-slate-400'}`}>
                    {m === 'register' ? 'Регистрация' : 'Вход'}
                  </button>
                ))}
              </div>
              {mode === 'register' && (
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ваше имя" className="input-field" />
              )}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Email" className="input-field" autoComplete="email" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Пароль" className="input-field" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? 'Подождите…' : mode === 'register' ? 'Зарегистрироваться и войти' : 'Войти и присоединиться'}
              </button>
            </form>
          )}
        </div>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1020] bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(37,99,235,0.25),transparent)] px-4">
      {children}
    </div>
  );
}
