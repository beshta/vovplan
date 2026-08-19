import { describe, it, expect } from 'vitest';
import { publicFrameSize } from './publicFrame';

describe('publicFrameSize', () => {
  it('на 4K ограничивает кадр 1920×1080', () => {
    expect(publicFrameSize(3840, 3840, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it('на обычном Full HD — 1280×720', () => {
    expect(publicFrameSize(1920, 1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it('окно меньше потолка — берёт окно', () => {
    expect(publicFrameSize(1920, 800, 500)).toEqual({ width: 800, height: 500 });
  });

  it('на 3K уже большой кадр, ниже — нет', () => {
    expect(publicFrameSize(2880, 2880, 1800)).toEqual({ width: 1920, height: 1080 });
    expect(publicFrameSize(2879, 2560, 1440)).toEqual({ width: 1280, height: 720 });
  });
});
