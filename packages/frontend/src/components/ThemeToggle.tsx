import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../shared/themeStore';

/**
 * Плавающий переключатель темы — справа внизу на всех страницах.
 * Выбор сохраняется в localStorage, поэтому действует на всю сессию
 * и на все страницы сразу (тема живёт на <html>, а не в компонентах).
 */
export default function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Светлая тема' : 'Тёмная тема'}
      aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      className="fixed bottom-5 right-5 z-[60] w-11 h-11 rounded-full flex items-center justify-center
        backdrop-blur-xl border shadow-lg transition-all active:scale-95
        bg-white/85 border-slate-900/10 text-slate-600 shadow-slate-900/10 hover:text-slate-900 hover:bg-white
        dark:bg-slate-900/80 dark:border-white/10 dark:text-slate-300 dark:shadow-black/40 dark:hover:text-white dark:hover:bg-slate-800"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
