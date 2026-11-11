import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from './math';

/**
 * All surface detail in the game is generated at load time: tileable noise
 * fields are turned into albedo + normal maps so nothing has to be downloaded.
 */

/** Tileable value noise, `cells` lattice points per side, result 0..1. */
function valueNoise(N: number, cells: number, seed: number): Float32Array {
  const r = mulberry32(seed);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * cells;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = lerp(lat[ya + xa], lat[ya + xb], sx);
      const b = lerp(lat[yb + xa], lat[yb + xb], sx);
      out[y * N + x] = lerp(a, b, sy);
    }
  }
  return out;
}

export function fbmField(N: number, baseCells: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(N * N);
  let amp = 1;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    if (cells > N / 2) break;
    const n = valueNoise(N, cells, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function finish(tex: THREE.Texture, srgb: boolean, aniso = 8): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

type Px = (x: number, y: number, i: number) => [number, number, number];

function colorTex(N: number, fn: Px): THREE.Texture {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const c = fn(x, y, i);
      data[i * 4] = clamp(c[0], 0, 1) * 255;
      data[i * 4 + 1] = clamp(c[1], 0, 1) * 255;
      data[i * 4 + 2] = clamp(c[2], 0, 1) * 255;
      data[i * 4 + 3] = 255;
    }
  }
  return finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat), true);
}

export function normalFromHeight(h: Float32Array, N: number, strength: number): THREE.Texture {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const xl = h[y * N + ((x - 1 + N) % N)];
      const xr = h[y * N + ((x + 1) % N)];
      const yu = h[((y - 1 + N) % N) * N + x];
      const yd = h[((y + 1) % N) * N + x];
      let nx = (xl - xr) * strength;
      let ny = (yu - yd) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * N + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat), false);
}

function mix3(a: number[], b: number[], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export interface TextureSet {
  grass: THREE.Texture;
  dirt: THREE.Texture;
  rock: THREE.Texture;
  sand: THREE.Texture;
  groundNormal: THREE.Texture;
  noise: THREE.Texture;
  waterNormal: THREE.Texture;
  plaster: THREE.Texture;
  plasterN: THREE.Texture;
  brick: THREE.Texture;
  brickN: THREE.Texture;
  concrete: THREE.Texture;
  concreteN: THREE.Texture;
  wood: THREE.Texture;
  woodN: THREE.Texture;
  roof: THREE.Texture;
  roofN: THREE.Texture;
  metal: THREE.Texture;
  metalN: THREE.Texture;
  bark: THREE.Texture;
  barkN: THREE.Texture;
  rockN: THREE.Texture;
  leaf: THREE.Texture;
  leafN: THREE.Texture;
}

export function createTextures(size = 512): TextureSet {
  const N = size;
  const fine = fbmField(N, 32, 5, 11, 0.62);
  const mid = fbmField(N, 6, 6, 23, 0.55);
  const coarse = fbmField(N, 3, 4, 37, 0.5);
  const speck = valueNoise(N, N / 2, 51);

  const grass = colorTex(N, (_x, _y, i) => {
    const t = mid[i] * 0.55 + fine[i] * 0.45;
    const c = mix3([0.16, 0.25, 0.07], [0.33, 0.43, 0.14], smoothstep(0.3, 0.72, t));
    const dry = smoothstep(0.55, 0.8, coarse[i]) * 0.35;
    const d = mix3(c, [0.42, 0.4, 0.17], dry);
    const s = 0.86 + speck[i] * 0.28;
    return [d[0] * s, d[1] * s, d[2] * s];
  });

  const dirtF = fbmField(N, 8, 6, 71, 0.6);
  const dirt = colorTex(N, (_x, _y, i) => {
    const t = dirtF[i] * 0.7 + fine[i] * 0.3;
    const c = mix3([0.37, 0.3, 0.22], [0.6, 0.51, 0.39], smoothstep(0.25, 0.75, t));
    const pebble = speck[i] > 0.86 ? 1.25 : 1;
    const s = (0.88 + speck[i] * 0.2) * pebble;
    return [c[0] * s, c[1] * s, c[2] * s];
  });

  const rockF = fbmField(N, 5, 7, 91, 0.62);
  const rockH = new Float32Array(N * N);
  for (let i = 0; i < rockH.length; i++) {
    const ridge = 1 - Math.abs(rockF[i] * 2 - 1);
    rockH[i] = rockF[i] * 0.6 + ridge * ridge * 0.4;
  }
  const rock = colorTex(N, (_x, _y, i) => {
    const t = rockH[i];
    const c = mix3([0.24, 0.23, 0.22], [0.52, 0.5, 0.46], smoothstep(0.2, 0.85, t));
    const moss = smoothstep(0.62, 0.8, mid[i]) * 0.25;
    const m = mix3(c, [0.28, 0.33, 0.18], moss);
    const s = 0.9 + speck[i] * 0.2;
    return [m[0] * s, m[1] * s, m[2] * s];
  });

  const sand = colorTex(N, (x, y, i) => {
    const ripple = Math.sin((x / N) * Math.PI * 2 * 14 + mid[i] * 9) * 0.5 + 0.5;
    const t = fine[i] * 0.5 + ripple * 0.18 + coarse[i] * 0.32;
    const c = mix3([0.62, 0.54, 0.38], [0.84, 0.77, 0.6], smoothstep(0.2, 0.8, t));
    const s = 0.93 + speck[i] * 0.14;
    void y;
    return [c[0] * s, c[1] * s, c[2] * s];
  });

  const gh = new Float32Array(N * N);
  for (let i = 0; i < gh.length; i++) gh[i] = fine[i] * 0.6 + speck[i] * 0.25 + mid[i] * 0.4;
  const groundNormal = normalFromHeight(gh, N, 2.2);
  const rockN = normalFromHeight(rockH, N, 5.5);

  const noise = (() => {
    const a = fbmField(256, 4, 6, 301, 0.55);
    const b = fbmField(256, 8, 5, 303, 0.5);
    const c = fbmField(256, 16, 4, 305, 0.5);
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) {
      data[i * 4] = a[i] * 255;
      data[i * 4 + 1] = b[i] * 255;
      data[i * 4 + 2] = c[i] * 255;
      data[i * 4 + 3] = 255;
    }
    return finish(new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat), false, 2);
  })();

  const wh = fbmField(N, 6, 5, 401, 0.58);
  const waterNormal = normalFromHeight(wh, N, 3.4);

  // --- architecture ----------------------------------------------------
  const stain = fbmField(N, 4, 6, 501, 0.6);
  const plaster = colorTex(N, (_x, y, i) => {
    const drip = smoothstep(0.55, 0.9, stain[i]) * (0.1 + 0.12 * (y / N));
    const s = 0.9 + fine[i] * 0.14 - drip;
    return [s, s * 0.995, s * 0.98];
  });
  const ph = new Float32Array(N * N);
  for (let i = 0; i < ph.length; i++) ph[i] = fine[i] * 0.7 + speck[i] * 0.3;
  const plasterN = normalFromHeight(ph, N, 1.1);

  // bricks: 1 tile = 1m, 8 courses x 4 bricks
  const bh = new Float32Array(N * N);
  const brick = colorTex(N, (x, y, i) => {
    const rows = 8;
    const cols = 4;
    const ry = (y / N) * rows;
    const row = Math.floor(ry);
    const fx = (x / N) * cols + (row % 2) * 0.5;
    const col = Math.floor(fx);
    const u = fx - col;
    const v = ry - row;
    const edge = Math.min(Math.min(u, 1 - u) * 4.2, Math.min(v, 1 - v) * 2.1);
    const m = smoothstep(0.08, 0.2, edge);
    const id = ((row * 7 + (col % cols) * 13) % 17) / 17;
    bh[i] = m * (0.75 + fine[i] * 0.25);
    const base = mix3([0.5, 0.2, 0.14], [0.66, 0.31, 0.2], id);
    const b = mix3([0.62, 0.6, 0.56], base, m);
    const s = 0.85 + fine[i] * 0.25 - smoothstep(0.6, 0.9, stain[i]) * 0.15;
    return [b[0] * s, b[1] * s, b[2] * s];
  });
  const brickN = normalFromHeight(bh, N, 4.5);

  const ch = new Float32Array(N * N);
  const concrete = colorTex(N, (x, y, i) => {
    const seam = Math.min(Math.abs(((x / N) * 2) % 1 - 0.5), Math.abs(((y / N) * 2) % 1 - 0.5));
    const line = smoothstep(0.0, 0.012, 0.5 - seam);
    ch[i] = fine[i] * 0.5 + speck[i] * 0.2 + line * 0.5;
    const s = 0.62 + fine[i] * 0.2 + mid[i] * 0.12 - (1 - line) * 0.2 - smoothstep(0.6, 0.95, stain[i]) * 0.12;
    return [s, s, s * 0.97];
  });
  const concreteN = normalFromHeight(ch, N, 1.8);

  // wood planks, 4 planks per tile running along U
  const grain = (() => {
    const g = new Float32Array(N * N);
    const src = fbmField(N, 4, 5, 601, 0.6);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      // stretch along x
      g[y * N + x] = src[((y * 6) % N) * N + ((x >> 1) % N)];
    }
    return g;
  })();
  const wdh = new Float32Array(N * N);
  const wood = colorTex(N, (x, y, i) => {
    const planks = 5;
    const py = (y / N) * planks;
    const pi = Math.floor(py);
    const v = py - pi;
    const gap = smoothstep(0.0, 0.05, Math.min(v, 1 - v));
    const id = ((pi * 5) % 7) / 7;
    const g = grain[i];
    wdh[i] = gap * (0.7 + g * 0.3);
    const base = mix3([0.3, 0.2, 0.11], [0.52, 0.37, 0.22], g * 0.7 + id * 0.3);
    const s = (0.75 + fine[i] * 0.3) * (0.45 + gap * 0.55);
    void x;
    return [base[0] * s, base[1] * s, base[2] * s];
  });
  const woodN = normalFromHeight(wdh, N, 3.2);

  // roof tiles: overlapping rows
  const rh = new Float32Array(N * N);
  const roof = colorTex(N, (x, y, i) => {
    const rows = 6;
    const cols = 6;
    const ry = (y / N) * rows;
    const row = Math.floor(ry);
    const v = ry - row;
    const fx = (x / N) * cols + (row % 2) * 0.5;
    const u = fx - Math.floor(fx);
    const round = Math.sin(u * Math.PI);
    rh[i] = (1 - v) * 0.7 + round * 0.3;
    const id = ((row * 3 + Math.floor(fx) * 5) % 11) / 11;
    const s = (0.62 + (1 - v) * 0.3 + round * 0.12) * (0.82 + id * 0.25) * (0.9 + fine[i] * 0.2);
    return [s, s, s];
  });
  const roofN = normalFromHeight(rh, N, 5);

  // corrugated metal: vertical ribs, 8 per tile
  const mh = new Float32Array(N * N);
  const metal = colorTex(N, (x, y, i) => {
    const rib = Math.sin((x / N) * Math.PI * 2 * 8) * 0.5 + 0.5;
    mh[i] = rib;
    const rust = smoothstep(0.58, 0.82, stain[i] * 0.7 + mid[i] * 0.3 + (y / N) * 0.1);
    const s = 0.82 + rib * 0.14 + fine[i] * 0.08;
    const c = mix3([s, s, s], [0.5 * s, 0.3 * s, 0.18 * s], rust * 0.55);
    return c;
  });
  const metalN = normalFromHeight(mh, N, 3.5);

  const bkh = new Float32Array(N * N);
  const bark = colorTex(N, (x, y, i) => {
    const g = grain[((x * 3) % N) * N + y];
    const crack = 1 - Math.abs(Math.sin((x / N) * Math.PI * 2 * 9 + mid[i] * 7));
    bkh[i] = crack * 0.6 + g * 0.4;
    const s = 0.55 + crack * 0.35 + g * 0.2;
    return [0.34 * s, 0.26 * s, 0.19 * s];
  });
  const barkN = normalFromHeight(bkh, N, 4);

  // foliage: clumps of light and shadow that read as leaf masses
  const lfA = fbmField(N, 20, 4, 701, 0.6);
  const lfB = fbmField(N, 56, 3, 703, 0.6);
  const lh = new Float32Array(N * N);
  const leaf = colorTex(N, (_x, _y, i) => {
    const t = smoothstep(0.32, 0.7, lfA[i] * 0.65 + lfB[i] * 0.35);
    lh[i] = t;
    const c = mix3([0.4, 0.5, 0.36], [1.0, 1.0, 0.82], t);
    const s = 0.9 + speck[i] * 0.1;
    return [c[0] * s, c[1] * s, c[2] * s];
  });
  const leafN = normalFromHeight(lh, N, 3.2);

  return {
    leaf, leafN,
    grass, dirt, rock, sand, groundNormal, noise, waterNormal,
    plaster, plasterN, brick, brickN, concrete, concreteN, wood, woodN, roof, roofN, metal, metalN, bark, barkN, rockN,
  };
}

/** Small radial sprite used by particles / decals / glows. */
export function radialTexture(size: number, inner: number, soft = true): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      let a = 1 - smoothstep(inner, 1, d);
      if (soft) a *= a;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
