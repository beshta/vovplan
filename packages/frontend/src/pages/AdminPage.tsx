import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Shield, ShieldCheck, ShieldOff, Ban, Search, Users, FolderOpen,
  Mountain, ScrollText, LayoutDashboard, LogOut, ChevronLeft, ChevronRight,
  KeyRound, Check, Copy, AlertTriangle, Globe, Star, Trash2, RotateCcw, Boxes,
  Eye, HardDrive, CreditCard,
} from 'lucide-react';
import { AccountLevel, LEVEL_LABELS } from '@vovplan/shared';
import {
  adminApi, ApiError, setAdminPass, clearAdminPass, getAdminPass, adminPassUntil,
  type AdminUserRow, type AdminAuditRow, type AdminProjectRow, type AdminProjectFilter,
} from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import { stamp } from '../features/viewer3d/utils/stamp';

/**
 * Панель хозяина сервиса.
 *
 * Три состояния входа, и порядок между ними не случаен: сначала выясняем, что
 * человек вообще хозяин, потом — что у него подключён второй фактор, и только
 * потом просим код. Пропуск живёт полчаса и лежит в sessionStorage, поэтому
 * перезагрузка страницы код не переспрашивает, а закрытие вкладки — да.
 */

const PAGE = 30;

export default function AdminPage() {
  const { user } = useAuthStore();
  const [pass, setPass] = useState<string | null>(getAdminPass());

  /*
   * Признак хозяина уже есть в профиле, поэтому чужой человек получает отказ
   * без единого запроса. Но верим мы не ему, а серверу: профиль в сторе мог
   * протухнуть, а второй фактор всё равно спрашивать у сервера.
   */
  const status = useQuery({
    queryKey: ['admin', 'status'],
    queryFn: adminApi.status,
    enabled: !!user?.isAdmin,
    retry: false,
    // Данные о втором факторе меняются только руками самого хозяина,
    // перепроверять их при каждом возврате на вкладку незачем
    refetchOnWindowFocus: false,
  });

  // Пропуск снимается в одном месте и одной функцией: с новой на каждый
  // отрисовке дочерние эффекты перезапускались бы вхолостую
  const lock = useCallback(() => {
    clearAdminPass();
    setPass(null);
  }, []);

  if (!user) return <Shell><p className="text-sm text-muted">Проверяю доступ…</p></Shell>;
  if (!user.isAdmin) return <Denied />;
  if (!status.data && !status.error) {
    return <Shell><p className="text-sm text-muted">Проверяю доступ…</p></Shell>;
  }
  if (status.error) {
    // 404 здесь означает «ты не хозяин»: сервер намеренно не подтверждает,
    // что по этому адресу вообще что-то есть
    return (status.error as ApiError).status === 404
      ? <Denied />
      : <Shell><Alert>{(status.error as Error).message}</Alert></Shell>;
  }

  if (!status.data?.totpEnabled) {
    return <SetupScreen onDone={() => status.refetch()} />;
  }

  if (!pass) {
    return <GateScreen onPass={setPass} />;
  }

  return <Panel onLock={lock} />;
}

// ── Общая обёртка входных экранов ─────────────
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen surface-page flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-strong mb-5 transition-colors">
          <ArrowLeft size={16} /> К проектам
        </Link>
        <div className="surface-card p-6">{children}</div>
      </div>
    </div>
  );
}

function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'ok' }) {
  const cls = kind === 'error'
    ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/25 dark:text-red-300'
    : 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/25 dark:text-emerald-300';
  return <div className={`mb-4 p-3 border rounded-xl text-sm flex items-start gap-2 ${cls}`}>{children}</div>;
}

/**
 * Для не-хозяина страницы не существует.
 *
 * Ровно то же, что отвечает сервер, и по той же причине: «недостаточно прав»
 * — это подтверждение, что админка тут есть.
 */
function Denied() {
  return (
    <Shell>
      <h1 className="font-display text-xl font-bold text-strong">Страница не найдена</h1>
      <p className="text-sm text-muted mt-2">
        Такого адреса нет. Возможно, ссылка устарела.
      </p>
      <Link to="/" className="btn-primary inline-block mt-5">На главную</Link>
    </Shell>
  );
}

// ── Подключение второго фактора ───────────────
/**
 * Первый заход хозяина: без второго фактора в админку не пускают вовсе.
 *
 * Резервные коды показываются ровно один раз — в базе только хеши. Поэтому
 * экран не отпускает человека дальше, пока он не подтвердит, что сохранил их.
 */
function SetupScreen({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const data = await adminApi.totpSetup();
      setSetup({ secret: data.secret, qr: data.qr });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { backupCodes } = await adminApi.totpEnable(code.trim());
      setCodes(backupCodes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <Shell>
        <h1 className="font-display text-xl font-bold text-strong">Резервные коды</h1>
        <p className="text-sm text-muted mt-2">
          Сохраните их сейчас — второй раз показать неоткуда, в базе лежат только отпечатки.
          Каждый код срабатывает один раз и заменяет код из приложения, если телефон недоступен.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <div key={c} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/5 text-strong text-center tracking-wider">
              {c}
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(codes.join('\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="btn-ghost mt-4 flex items-center gap-1.5"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Скопировано' : 'Скопировать все'}
        </button>
        <button onClick={onDone} className="btn-primary w-full mt-5">Я сохранил коды</button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-2.5">
        <Shield size={20} className="text-vovplan-600 dark:text-vovplan-400" />
        <h1 className="font-display text-xl font-bold text-strong">Второй фактор</h1>
      </div>
      <p className="text-sm text-muted mt-2">
        Админка открывается только по коду из приложения — одного пароля мало:
        он лежит в браузере неделями, а блокировать людей может кто угодно, кто до него дотянулся.
      </p>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      {!setup ? (
        <button onClick={start} disabled={busy} className="btn-primary w-full mt-5">
          {busy ? 'Готовлю…' : 'Подключить'}
        </button>
      ) : (
        <form onSubmit={confirm} className="mt-5">
          <img src={setup.qr} alt="QR-код для приложения" className="w-44 h-44 mx-auto rounded-xl bg-white p-2" />
          <p className="text-xs text-muted text-center mt-3">
            Отсканируйте в Google Authenticator, 1Password или Aegis. Если камера недоступна — введите ключ руками:
          </p>
          <p className="font-mono text-xs text-center text-strong mt-1.5 break-all select-all">{setup.secret}</p>

          <label className="input-label mt-5">Код из приложения</label>
          <input
            className="input-field text-center font-mono text-lg tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoFocus
          />
          <button type="submit" disabled={busy || code.length < 6} className="btn-primary w-full mt-4">
            {busy ? 'Проверяю…' : 'Подтвердить'}
          </button>
        </form>
      )}
    </Shell>
  );
}

// ── Ввод кода ради пропуска ───────────────────
function GateScreen({ onPass }: { onPass: (token: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { adminToken, expiresIn } = await adminApi.session(code.trim());
      setAdminPass(adminToken, expiresIn);
      onPass(adminToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex items-center gap-2.5">
        <KeyRound size={20} className="text-vovplan-600 dark:text-vovplan-400" />
        <h1 className="font-display text-xl font-bold text-strong">Вход в админку</h1>
      </div>
      <p className="text-sm text-muted mt-2">Код из приложения или резервный код.</p>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      <form onSubmit={submit} className="mt-5">
        <input
          className="input-field text-center font-mono text-lg tracking-[0.2em]"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          autoFocus
        />
        <button type="submit" disabled={busy || code.trim().length < 6} className="btn-primary w-full mt-4">
          {busy ? 'Проверяю…' : 'Войти'}
        </button>
      </form>
      <p className="text-xs text-muted mt-4">Пропуск действует 30 минут и не переживает закрытие вкладки.</p>
    </Shell>
  );
}

// ── Сама панель ───────────────────────────────
type Tab = 'summary' | 'users' | 'projects' | 'audit';

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'summary', label: 'Сводка', icon: LayoutDashboard },
  { id: 'users', label: 'Люди', icon: Users },
  { id: 'projects', label: 'Проекты', icon: FolderOpen },
  { id: 'audit', label: 'Журнал', icon: ScrollText },
];

function Panel({ onLock }: { onLock: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');

  return (
    <div className="min-h-screen surface-page">
      <header className="sticky top-0 z-20 border-b surface-bar">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-strong transition-colors">
              <ArrowLeft size={16} /> <span className="hidden sm:inline">К проектам</span>
            </Link>
            <div className="h-5 w-px bg-slate-900/10 dark:bg-white/10" />
            <span className="font-display text-lg font-bold tracking-wide text-strong flex items-center gap-2">
              <Shield size={17} className="text-vovplan-600 dark:text-vovplan-400" /> Админка
            </span>
          </div>
          <div className="flex items-center gap-3">
            <PassClock onExpire={onLock} />
            <button onClick={onLock} className="btn-ghost flex items-center gap-1.5">
              <LogOut size={15} /> <span className="hidden sm:inline">Закрыть</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-8">
        <nav className="flex gap-1 mb-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200 dark:ring-vovplan-500/30'
                  : 'text-muted hover:text-strong hover:bg-slate-900/5 dark:hover:bg-white/5'
              }`}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </nav>

        {tab === 'summary' && <SummaryTab onLock={onLock} />}
        {tab === 'users' && <UsersTab onLock={onLock} />}
        {tab === 'projects' && <ProjectsTab onLock={onLock} />}
        {tab === 'audit' && <AuditTab onLock={onLock} />}
      </main>
      <div className="h-16" />
    </div>
  );
}

/**
 * Сколько пропуску осталось.
 *
 * Не украшение: без часов человек узнаёт об истечении в момент, когда жмёт
 * «заблокировать» и получает отказ. Тик раз в полминуты — точности до секунды
 * здесь никто не ждёт.
 */
function PassClock({ onExpire }: { onExpire: () => void }) {
  const [left, setLeft] = useState(() => (adminPassUntil() ?? 0) - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const ms = (adminPassUntil() ?? 0) - Date.now();
      setLeft(ms);
      if (ms <= 0) onExpire();
    }, 30_000);
    return () => clearInterval(id);
  }, [onExpire]);

  if (left <= 0) return null;
  return (
    <span className="hidden sm:inline text-xs text-muted tabular-nums">
      пропуск ещё {Math.ceil(left / 60_000)} мин
    </span>
  );
}

/**
 * Ошибка запроса внутри панели.
 *
 * Истёкший пропуск — не ошибка, а состояние: человека возвращает на экран
 * ввода кода, а не оставляет перед красной плашкой без выхода.
 */
function useLockOnExpiry(error: unknown, onLock: () => void) {
  const expired = error instanceof ApiError && error.code === 'ADMIN_SESSION_REQUIRED';
  useEffect(() => {
    if (expired) onLock();
  }, [expired, onLock]);
}

// ── Сводка ────────────────────────────────────
function SummaryTab({ onLock }: { onLock: () => void }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['admin', 'summary'],
    queryFn: adminApi.summary,
    retry: false,
  });
  useLockOnExpiry(error, onLock);

  if (isLoading) return <p className="text-sm text-muted">Считаю…</p>;
  if (error) return <Alert>{(error as Error).message}</Alert>;
  if (!data) return null;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Users} label="Всего людей" value={data.users.total} />
        <Stat icon={Users} label="За неделю" value={data.users.week} hint={`за месяц ${data.users.month}`} />
        <Stat icon={FolderOpen} label="Проектов" value={data.projects} />
        <Stat icon={Mountain} label="Импортов рельефа" value={data.terrainImports} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <Stat icon={ShieldCheck} label="Администраторов" value={data.users.admins} />
        <Stat icon={Ban} label="Заблокированных" value={data.users.banned} danger={data.users.banned > 0} />
        <Stat icon={Globe} label="Публичных проектов" value={data.publicProjects} />
        <Stat icon={Trash2} label="В корзине" value={data.deletedProjects} />
      </div>
      {/*
        Платных тарифов нет: «бесплатных» — это уровень по умолчанию, остальные
        ячейки — фактический счёт. Когда появится биллинг, эти же места
        заполнятся деньгами, не ломая вёрстку.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <Stat
          icon={HardDrive}
          label="Диск"
          value={`${(data.storageBytes / 1024 ** 3).toFixed(2)} ГБ`}
        />
        <Stat
          icon={CreditCard}
          label="Бесплатных"
          value={data.levels.MASTER ?? 0}
          hint="уровень по умолчанию"
        />
        <Stat icon={Users} label={LEVEL_LABELS.MASTER_UNLIMITED} value={data.levels.MASTER_UNLIMITED ?? 0} />
        <Stat icon={Users} label={LEVEL_LABELS.DESIGNER} value={data.levels.DESIGNER ?? 0} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <Stat icon={Users} label={LEVEL_LABELS.SUPER_SPECTATOR} value={data.levels.SUPER_SPECTATOR ?? 0} />
        <Stat icon={Users} label={LEVEL_LABELS.SPECTATOR} value={data.levels.SPECTATOR ?? 0} />
      </div>
    </>
  );
}

function Stat({ icon: Icon, label, value, hint, danger }: {
  icon: typeof Users; label: string; value: number | string; hint?: string; danger?: boolean;
}) {
  return (
    <div className="surface-card p-5">
      <div className="flex items-center gap-2 text-muted">
        <Icon size={15} /> <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`mt-2 font-display text-3xl font-bold tabular-nums ${danger ? 'text-red-600 dark:text-red-400' : 'text-strong'}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Общая обёртка действий панели.
 *
 * Три исхода, и каждый обрабатывается по-своему: пропуск истёк — назад к
 * вводу кода; сервер просит свежий код — запоминаем действие и переспрашиваем,
 * чтобы человеку не пришлось начинать сначала; всё остальное — текст ошибки.
 *
 * Один хук на все вкладки: разбор этих трёх исходов легко переписать чуть
 * иначе в каждой, и тогда где-нибудь истёкший пропуск покажется красной
 * плашкой без выхода вместо возврата к вводу кода.
 */
function useAdminActions(onLock: () => void, refetch: () => Promise<unknown>) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id); setError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ADMIN_SESSION_REQUIRED') {
        onLock();
      } else if (e instanceof ApiError && e.code === 'STEP_UP_REQUIRED') {
        setPending(() => async () => { await fn(); await refetch(); });
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const codePrompt = pending ? (
    <CodeDialog
      title="Подтвердите действие"
      hint="Необратимое действие требует свежего кода — пропуск получен слишком давно."
      onClose={() => setPending(null)}
      onDone={async () => {
        const retry = pending;
        setPending(null);
        await retry();
      }}
    />
  ) : null;

  return { act, busyId, error, codePrompt };
}

// ── Люди ──────────────────────────────────────
function UsersTab({ onLock }: { onLock: () => void }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null);

  const { data, error: loadError, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'users', query, page],
    queryFn: () => adminApi.users(query, page),
    retry: false,
  });
  useLockOnExpiry(loadError, onLock);

  const { act, busyId, error, codePrompt } = useAdminActions(onLock, refetch);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(input.trim());
  };

  return (
    <>
      <form onSubmit={search} className="flex gap-2 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="input-field pl-9"
            placeholder="Имя или почта"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">Найти</button>
        {query && (
          <button type="button" onClick={() => { setInput(''); setQuery(''); setPage(1); }} className="btn-ghost">
            Сбросить
          </button>
        )}
      </form>

      {error && <Alert><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}</Alert>}
      {loadError && <Alert>{(loadError as Error).message}</Alert>}
      {isLoading && <p className="text-sm text-muted">Загружаю…</p>}

      {data && data.data.length === 0 && (
        <p className="text-sm text-muted">Никого не нашлось.</p>
      )}

      {data && data.data.length > 0 && (
        <div className="surface-card divide-y divide-slate-200 dark:divide-white/10">
          {data.data.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              busy={busyId === u.id}
              onBan={() => setBanTarget(u)}
              onUnban={() => act(u.id, () => adminApi.unban(u.id))}
              onGrant={() => act(u.id, () => adminApi.grant(u.id))}
              onRevoke={() => act(u.id, () => adminApi.revoke(u.id))}
              onLevel={(level) => act(u.id, () => adminApi.setLevel(u.id, level))}
            />
          ))}
        </div>
      )}

      {data && <Pager page={data.page} total={data.total} onPage={setPage} />}

      {banTarget && (
        <BanDialog
          user={banTarget}
          onClose={() => setBanTarget(null)}
          onConfirm={(reason) => {
            const target = banTarget;
            setBanTarget(null);
            return act(target.id, () => adminApi.ban(target.id, reason));
          }}
        />
      )}

      {codePrompt}
    </>
  );
}

function UserRow({ user, busy, onBan, onUnban, onGrant, onRevoke, onLevel }: {
  user: AdminUserRow;
  busy: boolean;
  onBan: () => void;
  onUnban: () => void;
  onGrant: () => void;
  onRevoke: () => void;
  onLevel: (level: AccountLevel) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const self = me?.id === user.id;

  return (
    <div className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-strong truncate">{user.displayName}</span>
          {user.isAdmin && <Badge kind="admin">админ</Badge>}
          {user.bannedAt && <Badge kind="ban">заблокирован</Badge>}
          {!user.emailVerified && <Badge kind="warn">почта не подтверждена</Badge>}
        </div>
        <p className="text-xs text-muted truncate">{user.email}</p>
        <p className="text-xs text-muted mt-0.5">
          с {stamp(user.createdAt)} · проектов: {user.projects}
          {user.banReason && <span className="text-red-600 dark:text-red-400"> · причина: {user.banReason}</span>}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {/*
          Уровень — выпадающий список, а не кнопки: их было бы пять на строку.
          Смена требует свежего кода, но человек об этом узнаёт только если
          пропуск успел остыть — панель сама переспросит и доведёт дело.
        */}
        <label className="sr-only" htmlFor={`level-${user.id}`}>Уровень доступа</label>
        <select
          id={`level-${user.id}`}
          className="input-field py-1.5 text-xs w-[190px]"
          value={user.accountLevel}
          disabled={busy}
          onChange={(e) => onLevel(e.target.value as AccountLevel)}
        >
          {Object.values(AccountLevel).map((level) => (
            <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
          ))}
        </select>

        {user.isAdmin ? (
          self ? null : (
            <button onClick={onRevoke} disabled={busy} className="btn-ghost flex items-center gap-1.5 disabled:opacity-40">
              <ShieldOff size={15} /> Снять права
            </button>
          )
        ) : (
          <button onClick={onGrant} disabled={busy || !!user.bannedAt} className="btn-ghost flex items-center gap-1.5 disabled:opacity-40">
            <ShieldCheck size={15} /> Выдать права
          </button>
        )}
        {user.bannedAt ? (
          <button onClick={onUnban} disabled={busy} className="btn-ghost flex items-center gap-1.5 disabled:opacity-40">
            <Check size={15} /> Разблокировать
          </button>
        ) : (
          <button onClick={onBan} disabled={busy || user.isAdmin} className="btn-danger flex items-center gap-1.5 disabled:opacity-40">
            <Ban size={15} /> Заблокировать
          </button>
        )}
      </div>
    </div>
  );
}

function Badge({ kind, children }: { kind: 'admin' | 'ban' | 'warn' | 'ok'; children: ReactNode }) {
  const cls = {
    admin: 'bg-vovplan-500/10 text-vovplan-700 dark:bg-vovplan-500/20 dark:text-vovplan-200',
    ban: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  }[kind];
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${cls}`}>{children}</span>;
}

// ── Проекты ───────────────────────────────────
const FILTERS: { id: AdminProjectFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'public', label: 'Публичные' },
  { id: 'featured', label: 'На главной' },
  { id: 'deleted', label: 'Корзина' },
];

/**
 * Проекты хозяина сервиса.
 *
 * Войти в чужой проект как участник отсюда нельзя: в комнате хозяина бы
 * увидели. Смотреть сцену — можно, отдельным снимком без сокета.
 */
function ProjectsTab({ onLock }: { onLock: () => void }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdminProjectFilter>('all');
  const [page, setPage] = useState(1);
  const [purgeTarget, setPurgeTarget] = useState<AdminProjectRow | null>(null);

  const { data, error: loadError, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'projects', query, filter, page],
    queryFn: () => adminApi.projects(query, filter, page),
    retry: false,
  });
  useLockOnExpiry(loadError, onLock);

  const { act, busyId, error, codePrompt } = useAdminActions(onLock, refetch);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(input.trim());
  };

  return (
    <>
      <form onSubmit={search} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="input-field pl-9"
            placeholder="Название проекта"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">Найти</button>
        {query && (
          <button type="button" onClick={() => { setInput(''); setQuery(''); setPage(1); }} className="btn-ghost">
            Сбросить
          </button>
        )}
      </form>

      <div className="flex gap-1.5 mb-5 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.id
                ? 'bg-vovplan-500/10 text-vovplan-700 ring-1 ring-vovplan-500/25 dark:bg-vovplan-600/20 dark:text-vovplan-200'
                : 'text-muted hover:text-strong hover:bg-slate-900/5 dark:hover:bg-white/5'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Alert><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}</Alert>}
      {loadError && <Alert>{(loadError as Error).message}</Alert>}
      {isLoading && <p className="text-sm text-muted">Загружаю…</p>}

      {data && data.data.length === 0 && <p className="text-sm text-muted">Проектов не нашлось.</p>}

      {data && data.data.length > 0 && (
        <div className="surface-card divide-y divide-slate-200 dark:divide-white/10">
          {data.data.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              busy={busyId === p.id}
              onPublic={(on) => act(p.id, () => adminApi.setPublic(p.id, on))}
              onFeature={(on) => act(p.id, () => adminApi.setFeatured(p.id, on))}
              onDelete={() => act(p.id, () => adminApi.deleteProject(p.id))}
              onRestore={() => act(p.id, () => adminApi.restoreProject(p.id))}
              onPurge={() => setPurgeTarget(p)}
            />
          ))}
        </div>
      )}

      {data && <Pager page={data.page} total={data.total} onPage={setPage} />}

      {purgeTarget && (
        <PurgeDialog
          project={purgeTarget}
          onClose={() => setPurgeTarget(null)}
          onConfirm={() => {
            const target = purgeTarget;
            setPurgeTarget(null);
            return act(target.id, () => adminApi.purgeProject(target.id));
          }}
        />
      )}

      {codePrompt}
    </>
  );
}

function ProjectRow({ project, busy, onPublic, onFeature, onDelete, onRestore, onPurge }: {
  project: AdminProjectRow;
  busy: boolean;
  onPublic: (on: boolean) => void;
  onFeature: (on: boolean) => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const deleted = project.deletedAt !== null;

  return (
    <div className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-strong truncate">{project.name}</span>
          {project.isFeatured && <Badge kind="admin">на главной</Badge>}
          {project.isPublic && <Badge kind="ok">публичный</Badge>}
          {deleted && <Badge kind="ban">в корзине</Badge>}
        </div>
        <p className="text-xs text-muted truncate">
          {project.owner ? `${project.owner.displayName} <${project.owner.email}>` : 'без хозяина'}
        </p>
        <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
          <Boxes size={12} /> {project.objects} объектов · {project.models} моделей · участников: {project.members}
          {' · '}{size(project.bytes)} · изменён {stamp(project.updatedAt)}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <Link to={`/admin/view/${project.id}`} className="btn-ghost flex items-center gap-1.5">
          <Eye size={15} /> Смотреть
        </Link>
        {deleted ? (
          <>
            <button onClick={onRestore} disabled={busy} className="btn-ghost flex items-center gap-1.5 disabled:opacity-40">
              <RotateCcw size={15} /> Вернуть
            </button>
            <button onClick={onPurge} disabled={busy} className="btn-danger flex items-center gap-1.5 disabled:opacity-40">
              <Trash2 size={15} /> Стереть
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onPublic(!project.isPublic)}
              disabled={busy}
              className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
              title={project.isPublic ? 'Закрыть доступ по короткой ссылке' : 'Открыть по короткой ссылке всем'}
            >
              <Globe size={15} /> {project.isPublic ? 'Закрыть' : 'Открыть'}
            </button>
            <button
              onClick={() => onFeature(!project.isFeatured)}
              disabled={busy}
              className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
              title="Показывать сцену проекта на главной"
            >
              <Star size={15} className={project.isFeatured ? 'fill-current' : ''} />
              {project.isFeatured ? 'Убрать' : 'На главную'}
            </button>
            <button onClick={onDelete} disabled={busy} className="btn-danger flex items-center gap-1.5 disabled:opacity-40">
              <Trash2 size={15} /> В корзину
            </button>
          </>
        )}
      </div>

      {project.isPublic && !deleted && (
        <p className="basis-full text-xs text-muted">
          Открыт по адресу{' '}
          <a href={`/p/${project.id}`} target="_blank" rel="noreferrer" className="text-vovplan-600 dark:text-vovplan-400 hover:underline">
            /p/{project.id}
          </a>
        </p>
      )}
    </div>
  );
}

const size = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

/**
 * Последняя остановка перед необратимым.
 *
 * Название набирается руками намеренно: «вы уверены?» пролистывают не глядя, а
 * чтобы перепечатать имя чужого проекта, приходится хотя бы прочитать, какой
 * именно сейчас исчезнет вместе со всеми файлами.
 */
function PurgeDialog({ project, onClose, onConfirm }: {
  project: AdminProjectRow;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');

  return (
    <Modal>
      <h2 className="font-display text-lg font-bold text-strong">Стереть «{project.name}» навсегда?</h2>
      <p className="text-sm text-muted mt-1.5">
        Исчезнут сцена, модели, комментарии и все загруженные файлы ({size(project.bytes)}). Отменить будет нельзя.
      </p>
      <label className="input-label mt-5">Наберите название проекта</label>
      <input
        className="input-field"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={project.name}
        autoFocus
      />
      <div className="flex gap-2 mt-5">
        <button
          onClick={onConfirm}
          disabled={typed.trim() !== project.name}
          className="btn-danger flex-1 py-2.5 disabled:opacity-40"
        >
          Стереть навсегда
        </button>
        <button onClick={onClose} className="btn-ghost flex-1">Отмена</button>
      </div>
    </Modal>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-5">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn-ghost disabled:opacity-30">
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-muted tabular-nums">{page} из {pages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="btn-ghost disabled:opacity-30">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ── Диалоги ───────────────────────────────────
function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-slate-900/40 backdrop-blur-sm">
      <div className="surface-card p-6 w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * Причина блокировки обязательна.
 *
 * Её видит и человек при попытке войти, и журнал через полгода, когда никто
 * уже не помнит, за что именно. Пустое поле сервер и так не примет.
 */
function BanDialog({ user, onClose, onConfirm }: {
  user: AdminUserRow;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal>
      <h2 className="font-display text-lg font-bold text-strong">Заблокировать {user.displayName}?</h2>
      <p className="text-sm text-muted mt-1.5">
        Человека выкинет из всех сессий немедленно, включая открытые сцены. Проекты и данные остаются на месте.
      </p>
      <label className="input-label mt-5">Причина</label>
      <textarea
        className="input-field min-h-[80px] resize-y"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Спам в комментариях к чужим проектам"
        autoFocus
      />
      <div className="flex gap-2 mt-5">
        <button
          onClick={() => onConfirm(reason.trim())}
          disabled={reason.trim().length < 3}
          className="btn-danger flex-1 py-2.5 disabled:opacity-40"
        >
          Заблокировать
        </button>
        <button onClick={onClose} className="btn-ghost flex-1">Отмена</button>
      </div>
    </Modal>
  );
}

/** Повторный код: меняет пропуск на свежий и возвращает управление действию */
function CodeDialog({ title, hint, onClose, onDone }: {
  title: string;
  hint: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { adminToken, expiresIn } = await adminApi.session(code.trim());
      setAdminPass(adminToken, expiresIn);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal>
      <h2 className="font-display text-lg font-bold text-strong">{title}</h2>
      <p className="text-sm text-muted mt-1.5">{hint}</p>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <form onSubmit={submit}>
        <input
          className="input-field text-center font-mono text-lg tracking-[0.2em] mt-4"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          autoFocus
        />
        <div className="flex gap-2 mt-4">
          <button type="submit" disabled={busy || code.trim().length < 6} className="btn-primary flex-1">
            {busy ? 'Проверяю…' : 'Подтвердить'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Отмена</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Журнал ────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  'admin.ban': 'заблокировал',
  'admin.unban': 'снял блокировку',
  'admin.grant': 'выдал права',
  'admin.revoke': 'снял права',
  'admin.totp-enable': 'подключил второй фактор',
  'admin.totp-reset': 'сбросил второй фактор',
  'admin.level': 'сменил уровень доступа',
  'admin.project-delete': 'отправил в корзину проект',
  'admin.project-restore': 'вернул из корзины проект',
  'admin.project-purge': 'стёр навсегда проект',
  'admin.project-public': 'сменил публичность проекта',
  'admin.project-feature': 'сменил показ на главной проекта',
  'admin.project-inspect': 'посмотрел проект',
};

function AuditTab({ onLock }: { onLock: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, isLoading } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => adminApi.audit(page),
    retry: false,
  });
  useLockOnExpiry(error, onLock);

  if (isLoading) return <p className="text-sm text-muted">Загружаю…</p>;
  if (error) return <Alert>{(error as Error).message}</Alert>;
  if (!data) return null;

  return (
    <>
      <p className="text-sm text-muted mb-4">
        Только чтение: записи не правятся и не удаляются — журнал, который можно подчистить, ничего не доказывает.
      </p>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted">Пока пусто.</p>
      ) : (
        <div className="surface-card divide-y divide-slate-200 dark:divide-white/10">
          {data.data.map((row) => <AuditRow key={row.id} row={row} />)}
        </div>
      )}
      <Pager page={data.page} total={data.total} onPage={setPage} />
    </>
  );
}

function AuditRow({ row }: { row: AdminAuditRow }) {
  const reason = useMemo(() => {
    const d = row.details as { reason?: unknown; from?: unknown; to?: unknown; on?: unknown } | null;

    if (typeof d?.reason === 'string') return `причина: ${d.reason}`;
    // Уровень пишется парой «было — стало»: без «было» запись отвечает только
    // на половину вопроса, а спрашивают обычно именно про понижение
    if (typeof d?.to === 'string') {
      const to = LEVEL_LABELS[d.to as AccountLevel] ?? d.to;
      const from = typeof d.from === 'string' ? LEVEL_LABELS[d.from as AccountLevel] ?? d.from : null;
      return from ? `${from} → ${to}` : `новый уровень: ${to}`;
    }
    if (typeof d?.on === 'boolean') return d.on ? 'включил' : 'выключил';
    return null;
  }, [row.details]);

  return (
    <div className="p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-medium text-strong">{row.actorName}</span>
        <span className="text-muted">{ACTION_LABELS[row.action] ?? row.action}</span>
        {row.targetLabel && <span className="text-strong">{row.targetLabel}</span>}
      </div>
      <p className="text-xs text-muted mt-1">
        {stamp(row.createdAt)}
        {row.ip && <> · {row.ip}</>}
      </p>
      {reason && <p className="text-xs text-muted mt-1">{reason}</p>}
    </div>
  );
}
