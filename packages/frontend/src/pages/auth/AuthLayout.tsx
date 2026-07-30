import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Та же витрина-сцена, что в герое лендинга — грузится отдельным чанком
const LandingScene = lazy(() => import('../landing/LandingScene'));

/**
 * Split-раскладка для экранов входа/регистрации (паттерн shadcn login-02):
 * слева — форма на светлом фоне (в тон лендингу), справа — тёмная панель
 * с живой 3D-сценой вместо статичной картинки.
 *
 * Светлые классы полей заданы здесь локально: глобальные .input-field/.glass
 * рассчитаны на тёмный HUD вьюера и на светлом фоне нечитаемы.
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#f7f8fc] text-slate-900">
      {/* ── Левая колонка: форма ── */}
      <div className="flex flex-col gap-6 p-6 md:p-10">
        <div className="flex justify-center lg:justify-start">
          <Link to="/" className="font-display text-xl font-bold tracking-wide text-slate-900">
            VOVPLAN
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-slate-600">{subtitle}</p>

            <div className="mt-8">{children}</div>

            <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
          </div>
        </div>

        <p className="text-center lg:text-left text-xs text-slate-400">© 2026 VOVPLAN · vovplan.com</p>
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

/** Светлые классы полей — общие для входа и регистрации */
export const authInput =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 text-slate-900 placeholder-slate-400 rounded-xl ' +
  'shadow-sm focus:outline-none focus:ring-2 focus:ring-vovplan-500/40 focus:border-vovplan-500 transition';

export const authLabel = 'block text-sm font-medium text-slate-700 mb-1.5';
