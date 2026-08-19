import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Хранение пропуска в админку.
 *
 * Проверяется одно свойство, зато то самое, ради которого срок вообще
 * записан рядом с пропуском: просроченный не должен уходить на сервер. Иначе
 * человек узнаёт об истечении отказом в ответ на «заблокировать», а страница
 * — только по коду ошибки, которого могло и не быть.
 */

// Тесты фронтенда идут в node, без браузера: sessionStorage нужно завести руками
class MemoryStorage {
  private data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
  clear = () => this.data.clear();
}

const store = new MemoryStorage();
vi.stubGlobal('sessionStorage', store);
vi.stubGlobal('localStorage', new MemoryStorage());

const { getAdminPass, setAdminPass, clearAdminPass, adminPassUntil } = await import('./api');

describe('пропуск в админку', () => {
  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('выдаётся, пока не истёк срок', () => {
    setAdminPass('pass-1', 30 * 60_000);
    expect(getAdminPass()).toBe('pass-1');
    expect(adminPassUntil()).toBe(Date.now() + 30 * 60_000);
  });

  it('после истечения срока не выдаётся и стирается', () => {
    setAdminPass('pass-1', 60_000);
    vi.advanceTimersByTime(60_001);

    expect(getAdminPass()).toBeNull();
    // Именно стирается, а не просто скрывается: иначе мёртвая строка лежала бы
    // в браузере до закрытия вкладки
    expect(sessionStorage.getItem('vovplan_admin_pass')).toBeNull();
  });

  it('испорченная запись не роняет страницу', () => {
    sessionStorage.setItem('vovplan_admin_pass', 'не json');
    expect(getAdminPass()).toBeNull();
    expect(sessionStorage.getItem('vovplan_admin_pass')).toBeNull();
  });

  it('выход из админки стирает пропуск', () => {
    setAdminPass('pass-1', 60_000);
    clearAdminPass();
    expect(getAdminPass()).toBeNull();
  });
});
