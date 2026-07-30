import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Map as MapIcon,
  Package,
  MapPin,
  Users,
  Construction,
  ShieldCheck,
  Link2,
  History,
  Footprints,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';

// Тяжёлый three.js-канвас грузим отдельным чанком — текст героя рисуется сразу
const LandingScene = lazy(() => import('./landing/LandingScene'));

const STEPS = [
  { icon: MapIcon, title: 'Импорт местности', text: 'Введите координаты — VOVPLAN подгрузит реальный рельеф 1:1, здания OSM и спутник.' },
  { icon: Package, title: 'Расстановка', text: 'Добавляйте 3D-объекты, модели и инженерные сети прямо на местности.' },
  { icon: MapPin, title: 'Разметка', text: 'Ставьте метки, аннотации и комментарии — чтобы всё было понятно команде.' },
  { icon: Users, title: 'Совместно', text: 'Приглашайте команду и работайте одновременно, изменения видны в реальном времени.' },
];

const FEATURES = [
  { icon: MapIcon, title: 'Реальный рельеф 1:1', text: 'DEM-высоты, спутник и схема, здания OSM — точная копия местности в масштабе.' },
  { icon: Construction, title: 'Инженерные сети', text: 'Рисуйте и редактируйте трассы сетей в 3D: цвет, толщина, слои, скрытие.' },
  { icon: MapPin, title: 'Аннотации и метки', text: 'Метки-указатели, линии и подписи с настройкой цвета и видимости.' },
  { icon: Users, title: 'Совместная работа', text: 'Real-time присутствие, курсоры коллег и живая лента активности.' },
  { icon: ShieldCheck, title: 'Доступ и права', text: 'Матрица прав на проект и отдельная роль для каждого участника.' },
  { icon: Link2, title: 'Share-ссылки', text: 'Публичный просмотр без регистрации — для заказчиков и зрителей.' },
  { icon: History, title: 'История версий', text: 'Снимки сцены и откат к любой предыдущей версии проекта.' },
  { icon: Footprints, title: 'Обзор от первого лица', text: 'Пройдитесь по площадке в режиме от первого лица, как на месте.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900 antialiased">
      {/* ── Навигация ── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/70 border-b border-slate-900/5">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <span className="font-display text-xl font-bold tracking-wide text-slate-900">VOVPLAN</span>
          <nav className="flex items-center gap-1.5">
            <Link to="/login" className="px-3.5 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors">
              Войти
            </Link>
            <Link to="/register" className="btn-primary text-sm">Регистрация</Link>
          </nav>
        </div>
      </header>

      {/* ── Герой ── */}
      <section className="relative overflow-hidden border-b border-slate-900/5">
        <TopoBg />
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_60%_100%_at_70%_0%,rgba(99,102,241,0.12),transparent)] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
          {/* Левая колонка — текст */}
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-vovplan-700 bg-vovplan-500/10 border border-vovplan-500/20 rounded-full px-3 py-1.5 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-vovplan-500 animate-pulse" />
              3D-платформа для совместных проектов
            </span>
            <h1 className="font-display text-[2.6rem] sm:text-6xl font-bold leading-[1.03] tracking-tight text-slate-900">
              Местность.<br />Объекты.{' '}
              <span className="bg-gradient-to-r from-vovplan-600 to-cyan-500 bg-clip-text text-transparent">Команда.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-600 max-w-lg leading-relaxed">
              Импортируйте настоящий рельеф, здания и спутник по координатам. Расставляйте объекты
              и инженерные сети, размечайте и обсуждайте — всей командой и в реальном времени.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/register" className="btn-primary text-base px-6 py-3 flex items-center gap-2">
                Создать аккаунт <ArrowRight size={18} />
              </Link>
              <Link
                to="/login"
                className="text-base px-6 py-3 rounded-xl font-medium bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm transition-colors"
              >
                Войти
              </Link>
            </div>
            <p className="mt-6 text-sm text-slate-500">Масштаб 1:1 · реальные координаты · без установки</p>
          </div>

          {/* Правая колонка — продукт во «вьюпорте» */}
          <div className="relative">
            <div className="relative rounded-2xl bg-[#0b1020] ring-1 ring-slate-900/10 shadow-2xl shadow-slate-900/25 overflow-hidden h-[400px] sm:h-[480px]">
              {/* Верхняя панель окна */}
              <div className="absolute top-0 inset-x-0 z-10 h-10 flex items-center gap-2 px-3.5 border-b border-white/10 bg-white/[0.04] backdrop-blur">
                <span className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                </span>
                <span className="ml-1 text-xs text-slate-400 font-medium">Демо · площадка в 3D</span>
                <span className="ml-auto text-[10px] font-bold tracking-widest text-cyan-300/90 border border-cyan-400/30 rounded px-1.5 py-0.5">
                  LIVE 3D
                </span>
              </div>

              {/* Канвас */}
              <div className="absolute inset-0 pt-10">
                <Suspense fallback={<SceneFallback />}>
                  <LandingScene />
                </Suspense>
              </div>

              {/* Подсказка «покрутите» */}
              <div className="absolute top-14 right-3 z-10 flex items-center gap-1.5 text-[11px] text-slate-300 bg-black/30 backdrop-blur rounded-full px-2.5 py-1 border border-white/10">
                <RotateCcw size={12} /> покрутите
              </div>

              {/* Координаты */}
              <div className="absolute bottom-3 left-3 z-10 text-[11px] font-mono text-slate-300 bg-black/35 backdrop-blur rounded-md px-2 py-1 border border-white/10">
                55.7558°N · 37.6173°E
              </div>

              {/* Масштабная линейка */}
              <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                <span className="flex items-end h-2.5">
                  <span className="w-px h-2.5 bg-slate-400/70" />
                  <span className="w-12 h-px self-center bg-slate-400/70" />
                  <span className="w-px h-2.5 bg-slate-400/70" />
                </span>
                50&nbsp;м
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Как это работает ── */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Как это работает</h2>
          <p className="text-slate-600 mt-3 text-lg">От координат до готового 3D-проекта на реальной местности — за четыре шага.</p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative">
              <div className="text-5xl font-display font-bold text-slate-900/[0.06] leading-none select-none">0{i + 1}</div>
              <div className="-mt-6 relative">
                <div className="w-11 h-11 rounded-xl bg-vovplan-500/10 border border-vovplan-500/20 flex items-center justify-center mb-4">
                  <s.icon size={22} className="text-vovplan-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-1.5">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Возможности ── */}
      <section className="border-y border-slate-900/5 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight text-center">Всё для работы с местностью</h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-vovplan-300 hover:shadow-lg hover:shadow-vovplan-500/5 hover:-translate-y-0.5 transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-slate-100 group-hover:bg-vovplan-500/10 flex items-center justify-center mb-4 transition-colors">
                  <f.icon size={20} className="text-slate-500 group-hover:text-vovplan-600 transition-colors" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Финальный призыв ── */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="relative rounded-3xl bg-[#0b1020] px-8 py-14 sm:px-14 sm:py-16 text-center overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(99,102,241,0.4),transparent)] pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_80%_120%,rgba(34,211,238,0.25),transparent)] pointer-events-none" />
          <h2 className="relative font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">Начните бесплатно</h2>
          <p className="relative mt-3 text-slate-300 text-lg">Создайте первый проект на реальной местности за пару минут.</p>
          <div className="relative mt-8 flex justify-center">
            <Link to="/register" className="btn-primary text-base px-7 py-3.5 flex items-center gap-2">
              Создать аккаунт <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Подвал ── */}
      <footer className="border-t border-slate-900/5">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <span className="font-display font-bold text-slate-700">VOVPLAN</span>
          <span>© 2026 · vovplan.com</span>
        </div>
      </footer>
    </div>
  );
}

/** Топографический мотив — концентрические контуры (как изолинии рельефа) */
function TopoBg() {
  const base =
    'M100 46 C133 44 158 66 158 98 C158 130 133 156 100 156 C67 156 42 130 42 98 C42 66 67 48 100 46 Z';
  const rings = [1, 1.18, 1.36, 1.54, 1.72, 1.9, 2.08, 2.26];
  return (
    <svg
      viewBox="0 0 200 200"
      className="absolute -right-24 -top-16 w-[640px] h-[640px] text-vovplan-400/25 pointer-events-none hidden sm:block"
      fill="none"
      aria-hidden
    >
      {rings.map((s, i) => (
        <path
          key={i}
          d={base}
          stroke="currentColor"
          strokeWidth={0.5}
          transform={`translate(${100 * (1 - s)} ${100 * (1 - s)}) scale(${s})`}
          opacity={1 - i * 0.1}
        />
      ))}
    </svg>
  );
}

function SceneFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
      <div className="animate-pulse">Загрузка 3D-демо…</div>
    </div>
  );
}
