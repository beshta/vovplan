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
    <div className="min-h-screen bg-[#0b1020] text-slate-200">
      {/* ── Навигация ── */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-[#0b1020]/70 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <span className="font-display text-xl font-bold tracking-wide text-white">VOVPLAN</span>
          <nav className="flex items-center gap-2">
            <Link to="/login" className="btn-ghost">Войти</Link>
            <Link to="/register" className="btn-primary">Регистрация</Link>
          </nav>
        </div>
      </header>

      {/* ── Герой ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_60%_-5%,rgba(99,102,241,0.28),transparent)] pointer-events-none" />
        <div className="max-w-6xl mx-auto px-5 pt-14 pb-20 grid lg:grid-cols-2 gap-10 items-center">
          {/* Левая колонка — текст */}
          <div className="relative">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest text-vovplan-300 bg-vovplan-500/10 border border-vovplan-500/20 rounded-full px-3 py-1 mb-5">
              3D-платформа для совместных проектов
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] text-white">
              Проектируйте на&nbsp;реальной местности&nbsp;— <span className="text-vovplan-400">вместе, в&nbsp;3D</span>
            </h1>
            <p className="mt-5 text-lg text-slate-400 max-w-xl">
              Импортируйте настоящий рельеф, здания и спутниковые снимки по координатам.
              Расставляйте объекты и инженерные сети, размечайте и обсуждайте — всей командой
              и в реальном времени.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register" className="btn-primary text-base px-6 py-3 flex items-center gap-2">
                Создать аккаунт <ArrowRight size={18} />
              </Link>
              <Link to="/login" className="btn-secondary text-base px-6 py-3">Войти</Link>
            </div>
          </div>

          {/* Правая колонка — живое 3D-демо */}
          <div className="relative">
            <div className="glass rounded-3xl overflow-hidden h-[380px] sm:h-[460px] bg-slate-900/40">
              <Suspense fallback={<SceneFallback />}>
                <LandingScene />
              </Suspense>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
              <RotateCcw size={15} /> Зажмите и покрутите мышью
            </div>
          </div>
        </div>
      </section>

      {/* ── Как это работает ── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-white text-center">Как это работает</h2>
        <p className="text-slate-400 text-center mt-3 max-w-2xl mx-auto">
          От координат до готового 3D-проекта на реальной местности — за четыре шага.
        </p>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="glass p-5 relative">
              <div className="text-xs font-bold text-vovplan-400/70 mb-3">0{i + 1}</div>
              <s.icon size={24} className="text-vovplan-400 mb-3" />
              <h3 className="font-semibold text-white mb-1.5">{s.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Возможности ── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-white text-center">Всё для работы с местностью</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass p-5 hover:bg-slate-800/70 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-vovplan-500/15 border border-vovplan-500/20 flex items-center justify-center mb-4">
                <f.icon size={20} className="text-vovplan-300" />
              </div>
              <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Финальный призыв ── */}
      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div className="glass rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,rgba(99,102,241,0.30),transparent)] pointer-events-none" />
          <h2 className="font-display text-3xl font-bold text-white relative">Начните бесплатно</h2>
          <p className="mt-3 text-slate-400 relative">Создайте первый проект на реальной местности за пару минут.</p>
          <div className="mt-7 flex justify-center relative">
            <Link to="/register" className="btn-primary text-base px-7 py-3 flex items-center gap-2">
              Создать аккаунт <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Подвал ── */}
      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <span className="font-display font-bold text-slate-400">VOVPLAN</span>
          <span>© 2026 · vovplan.com</span>
        </div>
      </footer>
    </div>
  );
}

function SceneFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
      <div className="animate-pulse">Загрузка 3D-демо…</div>
    </div>
  );
}
