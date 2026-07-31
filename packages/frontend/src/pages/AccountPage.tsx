import { useState, useRef, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, User as UserIcon, Lock, FolderOpen, CreditCard,
  Camera, Check, MapPin, LogOut,
} from 'lucide-react';
import { authApi, projectsApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { ROLE_LABELS, type Project } from '@vovplan/shared';

type Section = 'profile' | 'password' | 'projects' | 'billing';

const SECTIONS: { id: Section; label: string; icon: typeof UserIcon }[] = [
  { id: 'profile', label: 'Профиль', icon: UserIcon },
  { id: 'password', label: 'Безопасность', icon: Lock },
  { id: 'projects', label: 'Мои проекты', icon: FolderOpen },
  { id: 'billing', label: 'Подписка', icon: CreditCard },
];

export default function AccountPage() {
  const [section, setSection] = useState<Section>('profile');
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen surface-page">
      {/* Шапка */}
      <header className="sticky top-0 z-20 border-b surface-bar">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-strong transition-colors">
              <ArrowLeft size={16} /> <span className="hidden sm:inline">К проектам</span>
            </Link>
            <div className="h-5 w-px bg-slate-900/10 dark:bg-white/10" />
            <span className="font-display text-lg font-bold tracking-wide text-strong">Кабинет</span>
          </div>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="btn-ghost flex items-center gap-1.5"
          >
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-10 grid lg:grid-cols-[220px_1fr] gap-8">
        {/* Боковая навигация */}
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                section === s.id
                  ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                  : 'text-muted hover:text-strong hover:bg-slate-900/5 dark:hover:bg-white/5'
              }`}
            >
              <s.icon size={17} /> {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === 'profile' && <ProfileSection />}
          {section === 'password' && <PasswordSection />}
          {section === 'projects' && <ProjectsSection />}
          {section === 'billing' && <BillingSection />}
        </div>
      </main>

      {/* Отступ снизу, чтобы плавающая кнопка темы не перекрывала контент */}
      <div className="h-16" />
      {!user && null}
    </div>
  );
}

// ── Обёртка секции ────────────────────────────
function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="surface-card p-6 mb-5">
      <h2 className="font-display text-xl font-bold tracking-tight text-strong">{title}</h2>
      {description && <p className="text-sm text-muted mt-1.5">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Зелёная плашка «сохранено» — исчезает сама */
function useSavedFlag() {
  const [saved, setSaved] = useState(false);
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return [saved, flash] as const;
}

function Alert({ kind, children }: { kind: 'error' | 'ok'; children: React.ReactNode }) {
  const cls =
    kind === 'error'
      ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300'
      : 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/25 dark:text-emerald-300';
  return <div className={`mb-4 p-3 border rounded-xl text-sm flex items-center gap-2 ${cls}`}>{children}</div>;
}

// ── Профиль ───────────────────────────────────
function ProfileSection() {
  const { user, setUser } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useSavedFlag();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setUser(await authApi.updateProfile({ displayName }));
      flashSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      setUser(await authApi.uploadAvatar(file));
      flashSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const initials = (user?.displayName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <Card title="Профиль" description="Как вас видят коллеги в проектах.">
      {error && <Alert kind="error">{error}</Alert>}
      {saved && <Alert kind="ok"><Check size={15} /> Сохранено</Alert>}

      {/* Аватар */}
      <div className="flex items-center gap-5 mb-7">
        <div className="relative shrink-0">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="w-20 h-20 rounded-2xl object-cover border border-slate-200 dark:border-white/10"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-vovplan-500 via-violet-500 to-cyan-500 flex items-center justify-center text-white font-display text-2xl font-bold">
              {initials}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Загрузить аватар"
            className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 shadow flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-vovplan-600 transition-colors"
          >
            <Camera size={15} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickAvatar(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="text-sm text-muted">
          <p className="font-medium text-strong">{user?.displayName}</p>
          <p>{user?.email}</p>
          <p className="mt-1 text-xs">PNG, JPEG или WebP · обрежется до квадрата 256×256</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <div>
          <label htmlFor="dn" className="input-label">Отображаемое имя</label>
          <input
            id="dn"
            className="input-field"
            value={displayName}
            minLength={2}
            required
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="em" className="input-label">Email</label>
          <input id="em" className="input-field opacity-60 cursor-not-allowed" value={user?.email ?? ''} disabled />
          <p className="mt-1.5 text-xs text-muted">Email пока изменить нельзя</p>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Сохранение...' : 'Сохранить'}
        </button>
      </form>
    </Card>
  );
}

// ── Смена пароля ──────────────────────────────
function PasswordSection() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flashSaved] = useSavedFlag();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== repeat) {
      setError('Новый пароль и повтор не совпадают');
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrent(''); setNew(''); setRepeat('');
      flashSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Безопасность" description="Смена пароля. Потребуется текущий пароль.">
      {error && <Alert kind="error">{error}</Alert>}
      {saved && <Alert kind="ok"><Check size={15} /> Пароль изменён</Alert>}

      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <div>
          <label htmlFor="cp" className="input-label">Текущий пароль</label>
          <input
            id="cp" type="password" required autoComplete="current-password"
            className="input-field" value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="np" className="input-label">Новый пароль</label>
          <input
            id="np" type="password" required minLength={8} autoComplete="new-password"
            className="input-field" value={newPassword} placeholder="Минимум 8 символов"
            onChange={(e) => setNew(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rp" className="input-label">Повторите новый пароль</label>
          <input
            id="rp" type="password" required minLength={8} autoComplete="new-password"
            className="input-field" value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Сохранение...' : 'Изменить пароль'}
        </button>
      </form>
    </Card>
  );
}

// ── Доступные проекты ─────────────────────────
function ProjectsSection() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const projects: Project[] = data?.data ?? [];

  return (
    <Card title="Мои проекты" description="Проекты, к которым у вас есть доступ, и ваша роль в каждом.">
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="text-muted text-sm">Пока нет доступных проектов.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => navigate(`/projects/${p.id}`)}
                className="w-full text-left py-3.5 flex items-center justify-between gap-4 hover:opacity-80 transition-opacity"
              >
                <div className="min-w-0">
                  <p className="font-medium text-strong truncate">{p.name}</p>
                  <p className="text-xs text-muted font-mono flex items-center gap-1 mt-0.5">
                    <MapPin size={11} /> {p.centerLat.toFixed(4)}, {p.centerLng.toFixed(4)}
                  </p>
                </div>
                {p.myRole && (
                  <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap shrink-0 bg-vovplan-500/10 text-vovplan-700 border border-vovplan-500/20 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:border-vovplan-500/30">
                    {ROLE_LABELS[p.myRole]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Подписка ──────────────────────────────────
const PLANS = [
  {
    id: 'free', name: 'Бесплатный', price: '0 ₽', period: 'навсегда',
    features: ['До 3 проектов', 'Импорт местности', 'Совместная работа', 'Share-ссылки'],
    current: true,
  },
  {
    id: 'pro', name: 'Профессиональный', price: '990 ₽', period: 'в месяц',
    features: ['Безлимит проектов', 'История версий без ограничений', 'Приоритетный импорт', 'Поддержка в течение суток'],
    highlight: true,
  },
  {
    id: 'team', name: 'Команда', price: '2 900 ₽', period: 'в месяц',
    features: ['Всё из «Профессионального»', 'Единый биллинг команды', 'Матрица прав и аудит', 'Персональный менеджер'],
  },
];

function BillingSection() {
  const queryClient = useQueryClient();
  void queryClient; // задел под будущую инвалидацию после оплаты

  return (
    <Card title="Подписка" description="Текущий тариф и доступные планы.">
      <div className="mb-6 p-4 rounded-xl bg-vovplan-500/[0.07] border border-vovplan-500/20">
        <p className="text-sm text-muted">Текущий тариф</p>
        <p className="font-display text-lg font-bold text-strong mt-0.5">Бесплатный</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-2xl border p-5 flex flex-col ${
              plan.highlight
                ? 'border-vovplan-400 dark:border-vovplan-500/50 shadow-lg shadow-vovplan-500/10'
                : 'border-slate-200 dark:border-white/10'
            }`}
          >
            {plan.highlight && (
              <span className="self-start text-[10px] font-bold uppercase tracking-widest text-white bg-gradient-to-r from-vovplan-600 via-violet-500 to-cyan-500 rounded-full px-2 py-0.5 mb-3">
                Популярный
              </span>
            )}
            <h3 className="font-semibold text-strong">{plan.name}</h3>
            <p className="mt-2">
              <span className="font-display text-2xl font-bold text-strong">{plan.price}</span>{' '}
              <span className="text-sm text-muted">{plan.period}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check size={15} className="text-vovplan-500 shrink-0 mt-0.5" /> {f}
                </li>
              ))}
            </ul>
            <button
              disabled={plan.current}
              title={plan.current ? undefined : 'Оплата пока не подключена'}
              className={`mt-5 w-full ${plan.current ? 'btn-secondary cursor-default' : 'btn-primary'}`}
            >
              {plan.current ? 'Текущий тариф' : 'Выбрать'}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-5 text-xs text-muted">
        Приём оплаты ещё не подключён — кнопки тарифов пока неактивны.
      </p>
    </Card>
  );
}
