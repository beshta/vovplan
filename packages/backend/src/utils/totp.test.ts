import { describe, it, expect, afterEach, vi } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
  backupCodeMatches,
} from './totp';

/**
 * Второй фактор проверяется векторами из самого RFC 6238, а не кодами,
 * которые сгенерировал этот же код. Иначе «работает» означало бы лишь
 * «совпало с собственной реализацией», и расхождение с приложением
 * аутентификатора вылезло бы у хозяина при попытке войти — то есть в самый
 * неподходящий момент.
 *
 * Секрет из RFC — ASCII «12345678901234567890», в base32 это
 * GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ. Векторы там восьмизначные, у нас коды
 * шестизначные, поэтому берём последние шесть знаков.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const RFC_VECTORS: { unixTime: number; code: string }[] = [
  { unixTime: 59, code: '287082' },
  { unixTime: 1111111109, code: '081804' },
  { unixTime: 1111111111, code: '050471' },
  { unixTime: 1234567890, code: '005924' },
  { unixTime: 2000000000, code: '279037' },
];

afterEach(() => {
  vi.useRealTimers();
});

/** Верный код для заданного секрета в текущий момент */
function codeNow(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

describe('коды из приложения-аутентификатора', () => {
  it.each(RFC_VECTORS)('код из RFC 6238 на времени $unixTime принимается', ({ unixTime, code }) => {
    vi.useFakeTimers();
    vi.setSystemTime(unixTime * 1000);
    expect(verifyTotp(RFC_SECRET, code)).not.toBeNull();
  });

  it('чужой код не принимается', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);
    expect(verifyTotp(RFC_SECRET, '000000')).toBeNull();
  });

  it('код отстающих часов принимается — часы расходятся у всех', () => {
    const secret = generateTotpSecret();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const code = codeNow(secret);

    // Человек набрал код, пока шёл следующий шаг
    vi.setSystemTime(1_700_000_000_000 + 30_000);
    expect(verifyTotp(secret, code)).not.toBeNull();
  });

  it('код позапрошлого шага уже не принимается', () => {
    const secret = generateTotpSecret();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const code = codeNow(secret);

    // Допуск ровно один шаг: иначе подсмотренный код живёт слишком долго
    vi.setSystemTime(1_700_000_000_000 + 90_000);
    expect(verifyTotp(secret, code)).toBeNull();
  });

  it('возвращается номер шага — по нему ловится повторное использование', () => {
    const secret = generateTotpSecret();
    vi.useFakeTimers();

    vi.setSystemTime(1_700_000_000_000);
    const first = verifyTotp(secret, codeNow(secret));

    vi.setSystemTime(1_700_000_060_000);
    const second = verifyTotp(secret, codeNow(secret));

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('мусор вместо кода отсеивается до проверки', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      expect(verifyTotp(RFC_SECRET, bad)).toBeNull();
    }
  });

  it('пробелы внутри кода не мешают — их вставляет и сам аутентификатор', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);
    expect(verifyTotp(RFC_SECRET, '287 082')).not.toBeNull();
  });

  it('разные секреты дают разные коды', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
    expect(codeNow(a)).not.toBe(codeNow(b));
  });

  it('ссылка для QR содержит сервис и адрес — в приложении их десятки', () => {
    const uri = totpUri(RFC_SECRET, 'info@vovplan.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('VOVPLAN');
    expect(uri).toContain('info%40vovplan.com');
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });
});

describe('резервные коды', () => {
  it('выдаётся десяток непохожих кодов', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  });

  it('код узнаётся, как бы его ни переписали с бумаги', () => {
    const [code] = generateBackupCodes();
    const stored = hashBackupCode(code);

    // Регистр, лишние дефисы и пробелы человек воспроизводит как придётся
    expect(hashBackupCode(code.toUpperCase())).toBe(stored);
    expect(hashBackupCode(code.replace('-', ''))).toBe(stored);
    expect(hashBackupCode(` ${code} `)).toBe(stored);
  });

  it('чужой код не подходит', () => {
    const [a, b] = generateBackupCodes();
    expect(hashBackupCode(a)).not.toBe(hashBackupCode(b));
  });

  it('приведение к единому виду оставляет только знаки кода', () => {
    expect(normalizeBackupCode('A3F9-2B71')).toBe('a3f92b71');
  });

  it('сравнение хешей не падает на разной длине', () => {
    expect(backupCodeMatches(hashBackupCode('a3f9-2b71'), 'коротко')).toBe(false);
    const h = hashBackupCode('a3f9-2b71');
    expect(backupCodeMatches(h, h)).toBe(true);
  });
});
