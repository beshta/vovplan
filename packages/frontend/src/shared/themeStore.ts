import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vovplan_theme';

/** Применяет тему к <html>: класс `dark` включает все dark:-варианты Tailwind */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // color-scheme даёт нативным элементам (скроллбары, поля) правильный вид
  root.style.colorScheme = theme;
}

/**
 * Тема при старте: сохранённый выбор пользователя, иначе светлая.
 * Системную настройку намеренно не учитываем — светлая тема основная,
 * тёмная включается только кнопкой.
 */
function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light', // перезапишется initTheme() до первого рендера

  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

/** Вызывать один раз до рендера — чтобы не мигало светлой темой при загрузке */
export function initTheme() {
  const theme = initialTheme();
  applyTheme(theme);
  useThemeStore.setState({ theme });
}
