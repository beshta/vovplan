/**
 * Когда это поставили: «10.08.2026, 19:52».
 *
 * Секунд нет намеренно — на площадке важны день и час, а не мгновение.
 * Общая для подписи в сцене и строки в списке: расходящиеся форматы одной и
 * той же даты в двух местах экрана читаются как два разных события.
 */
export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
