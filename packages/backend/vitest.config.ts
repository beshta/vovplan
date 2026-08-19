import { defineConfig } from 'vitest/config';

/**
 * Один воркер на весь набор.
 *
 * Тесты делят один SQLite-файл. Параллельные файлы снимают `isAdmin` друг
 * у друга и падают только в CI, где база пустая и воркеров больше.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
