/**
 * Адрес файла, который бэкенд отдал относительным путём (`/uploads/...`).
 *
 * База должна совпадать с API: пустая строка — тот же origin, что и страница.
 * Запасной `http://localhost:4000` здесь нельзя: в проде Vite не подставляет
 * VITE_API_URL, и тогда three.js качал бы модель с компьютера посетителя.
 * Рельеф так не делает — поэтому на сервере земля была, а модели нет.
 */
export function assetUrl(url: string, apiBase: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiBase}${url}`;
}
