/**
 * Perlin/Simplex noise — self-contained, no external deps.
 *
 * Used by DemTerrain for procedural terrain generation when no
 * heightmap PNG is provided.
 *
 * Based on Stefan Gustavson's simplex noise implementation.
 */

// ── Gradients for 2D simplex ──
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

// ── Skewing factors for 2D simplex ──
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** Permutation table (doubled for overflow safety) */
const PERM = new Uint8Array(512);

/** Seed the noise generator */
function seedNoise(seed = 12345): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  // Fisher-Yates shuffle with seeded PRNG
  let s = seed;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }

  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

// Auto-seed on module load
seedNoise();

/**
 * 2D Simplex noise — returns value in range [-1, 1].
 */
export function noise2D(xin: number, yin: number): number {
  let n0 = 0, n1 = 0, n2 = 0;

  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  let i1: number, j1: number;
  if (x0 > y0) { i1 = 1; j1 = 0; }
  else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;
  const gi0 = PERM[ii + PERM[jj]] % 12;
  const gi1 = PERM[ii + i1 + PERM[jj + j1]] % 12;
  const gi2 = PERM[ii + 1 + PERM[jj + 1]] % 12;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0); }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1); }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2); }

  return 70 * (n0 + n1 + n2);
}

/**
 * Fractal Brownian Motion (fBm) — layered noise for natural terrain.
 *
 * @param x, y — coordinates
 * @param octaves — number of noise layers (4-6 is good for terrain)
 * @param lacunarity — frequency multiplier per octave (typically 2.0)
 * @param gain — amplitude multiplier per octave (typically 0.5)
 * @returns value in range [-1, 1]
 */
export function fbm(
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5,
): number {
  let freq = 1.0;
  let amp = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return sum / norm;
}

/**
 * Ridged multifractal — produces sharp ridges (mountain ranges).
 */
export function ridged(
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5,
): number {
  let freq = 1.0;
  let amp = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2D(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return (sum / norm) * 2 - 1;
}

/** Re-seed the noise generator */
export function reseed(seed: number): void {
  seedNoise(seed);
}
