import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Та же витрина-сцена, что в герое лендинга — грузится отдельным чанком
const LandingScene = lazy(() => import('../landing/LandingScene'));

/**
 * Split-раскладка для экранов входа/регистрации (паттерн shadcn login-02):
 * слева — форма, справа — панель с живой 3D-сценой вместо статичной картинки.
 * Панель со сценой всегда тёмная — сцена рассчитана на тёмный фон.
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 surface-page">
      {/* ── Левая колонка: форма ── */}
      <div className="flex flex-col gap-6 p-6 md:p-10">
        <div className="flex justify-center lg:justify-start">
          <Link to="/" className="font-display text-xl font-bold tracking-wide text-strong">
            VOVPLAN
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-bold tracking-tight text-strong">{title}</h1>
            <p className="mt-2 text-muted">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <div className="mt-6 text-center text-sm text-muted">{footer}</div>
          </div>
        </div>

        <p className="text-center lg:text-left text-xs text-slate-400 dark:text-slate-500">© 2026 VOVPLAN · vovplan.com</p>
      </div>

      {/* ── Правая колонка: живое 3D (скрыта на мобильных) ── */}
      <div className="relative hidden lg:block bg-[#0b1020] overflow-hidden">
        <Suspense fallback={null}>
          <LandingScene />
        </Suspense>

        {/* Подпись поверх сцены */}
        <div className="absolute bottom-8 left-8 right-8 pointer-events-none">
          <p className="font-display text-2xl font-bold text-white leading-tight">
            Проектируйте на реальной местности
          </p>
          <p className="mt-2 text-slate-400 text-sm max-w-sm">
            Рельеф 1:1, объекты и инженерные сети — всей командой в реальном времени.
          </p>
        </div>

        <div className="absolute top-6 right-6 text-[10px] font-mono text-slate-500 pointer-events-none">
          55.7558°N · 37.6173°E
        </div>
      </div>
    </div>
  );
}

/** Классы полей — общие для входа и регистрации (темозависимые) */
export const authInput = 'input-field';

export const authLabel = 'input-label';
