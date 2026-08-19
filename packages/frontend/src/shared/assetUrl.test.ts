import { describe, expect, it } from 'vitest';
import { assetUrl } from './assetUrl';

describe('assetUrl', () => {
  it('без VITE_API_URL оставляет путь относительным — как Caddy на проде', () => {
    const signed = '/uploads/p/model.glb?exp=1&sig=abc';
    expect(assetUrl(signed, '')).toBe(signed);
    expect(assetUrl(signed, '')).not.toContain('localhost');
  });

  it('с отдельным API склеивает базу и путь', () => {
    expect(assetUrl('/uploads/a.glb', 'https://api.example')).toBe(
      'https://api.example/uploads/a.glb',
    );
  });

  it('абсолютный адрес не трогает', () => {
    expect(assetUrl('https://cdn.example/a.glb', '')).toBe('https://cdn.example/a.glb');
  });
});
