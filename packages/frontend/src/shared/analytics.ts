/**
 * Аналитика воронки: от захода на лендинг до первого объекта в сцене.
 *
 * Собирается в собственную базу, наружу ничего не уходит. Персональных данных
 * не пишем: ни cookie, ни отпечатков — только анонимный идентификатор вкладки,
 * который живёт в sessionStorage и исчезает вместе с ней. Он нужен, чтобы
 * считать воронку по людям, а не по кликам.
 */

const KEY = 'vovplan_anon';

export type AnalyticsEvent =
  | 'landing.view'
  | 'register.start'
  | 'register.done'
  | 'login.done'
  | 'project.create'
  | 'terrain.import'
  | 'object.place';

function anonId(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Отправляет событие. Никогда не бросает и ничего не ждёт: сбой аналитики
 * не должен влиять на работу с продуктом.
 */
export function track(name: AnalyticsEvent, meta?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({
      name,
      anonId: anonId(),
      path: location.pathname,
      referrer: document.referrer || undefined,
      meta,
    });

    // sendBeacon переживает уход со страницы — важно для событий вроде
    // перехода на регистрацию, где обычный fetch успевает отмениться
    const token = localStorage.getItem('vovplan_token');
    if (!token && navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      return;
    }

    // Для вошедших нужен заголовок авторизации — sendBeacon его не умеет
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* приватный режим без sessionStorage и подобное — просто не считаем */
  }
}
