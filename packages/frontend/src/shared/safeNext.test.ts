import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext', () => {
  it('принимает путь приглашения', () => {
    expect(safeNext('/invite/SLqnvKvmJpq3eDfYvxs754gq')).toBe('/invite/SLqnvKvmJpq3eDfYvxs754gq');
  });

  it('отсекает чужой сайт', () => {
    expect(safeNext('https://evil.example/')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
  });
});
