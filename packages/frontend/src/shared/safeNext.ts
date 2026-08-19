/**
 * Куда вернуться после входа. Только относительный путь своего сайта:
 * `//evil` и `https://…` отсекаются, иначе ссылка приглашения стала бы
 * открытой дверью на чужой домен.
 */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw.slice(0, 300);
}
