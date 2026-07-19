
/**
 * Detect device capabilities and return a quality profile.
 * Mobile devices get reduced shadows and lower LOD.
 */

/** Тач-устройство (включая новые iPad, которые прикидываются Mac) */
export function isTouchDevice(): boolean {
  return (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
}

export function detectQuality() {
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    // iPadOS 13+ выдаёт себя за Macintosh, но с тач-экраном
    (/Macintosh/i.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as any).deviceMemory ?? 4; // GB, Chrome only

  if (isMobile || cores <= 4 || memory <= 2) {
    return {
      isMobile,
      maxAnisotropy: 1,
      shadowMapSize: 1024,
      maxLod: 2 as const,
      enableShadows: true,
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    };
  }

  return {
    isMobile: false,
    maxAnisotropy: 4,
    shadowMapSize: 2048,
    maxLod: 0 as const,
    enableShadows: true,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
  };
}

export type DeviceQuality = ReturnType<typeof detectQuality>;
