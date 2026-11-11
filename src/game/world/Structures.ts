import { GeoBuilder } from '../core/GeoBuilder';
import { rpick, rrange, type Rng } from '../core/math';
import { SURF_CONCRETE, SURF_DIRT, SURF_METAL, SURF_WOOD, type ColliderWorld } from './Colliders';

/**
 * Procedural architecture and props. Every generator writes render geometry
 * into the GeoBuilder and matching collision volumes into the ColliderWorld,
 * expressed in the local frame of the structure being built.
 */

export interface BuildingInfo {
  id: number;
  kind: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  doors: { ox: number; oz: number; ix: number; iz: number }[];
  stair?: { bx: number; bz: number; tx: number; tz: number; topY: number };
}

export interface LootSpot {
  x: number;
  y: number;
  z: number;
  building: number;
  upstairs: boolean;
  tier: number;
}

export interface Ctx {
  gb: GeoBuilder;
  col: ColliderWorld;
  rng: Rng;
  x: number;
  y: number;
  z: number;
  yaw: number;
  cos: number;
  sin: number;
  buildings: BuildingInfo[];
  loot: LootSpot[];
  tier: number;
  /** building currently being generated (-1 for free standing props) */
  bid: number;
}

export function makeCtx(gb: GeoBuilder, col: ColliderWorld, rng: Rng, buildings: BuildingInfo[], loot: LootSpot[]): Ctx {
  return { gb, col, rng, x: 0, y: 0, z: 0, yaw: 0, cos: 1, sin: 0, buildings, loot, tier: 1, bid: -1 };
}

/** enter a local frame (world position + yaw) */
export function begin(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  c.x = x;
  c.y = y;
  c.z = z;
  c.yaw = yaw;
  c.cos = Math.cos(yaw);
  c.sin = Math.sin(yaw);
  c.gb.push(x, y, z, yaw);
}
export function end(c: Ctx): void {
  c.gb.pop();
  c.bid = -1;
  c.x = 0;
  c.y = 0;
  c.z = 0;
  c.yaw = 0;
  c.cos = 1;
  c.sin = 0;
}

export function toWorld(c: Ctx, lx: number, lz: number): [number, number] {
  return [c.x + lx * c.cos + lz * c.sin, c.z - lx * c.sin + lz * c.cos];
}
function cbox(c: Ctx, lx: number, lz: number, sx: number, sz: number, y0: number, y1: number, surf: number, rot = 0, y1b?: number): void {
  const [wx, wz] = toWorld(c, lx, lz);
  c.col.addBox(wx, wz, sx / 2, sz / 2, c.yaw + rot, c.y + y0, c.y + y1, surf, y1b !== undefined ? c.y + y1b : undefined);
}
function ccyl(c: Ctx, lx: number, lz: number, r: number, y0: number, y1: number, surf: number): void {
  const [wx, wz] = toWorld(c, lx, lz);
  c.col.addCyl(wx, wz, r, c.y + y0, c.y + y1, surf);
}
/** visible + solid box, y is the centre */
function sbox(c: Ctx, mat: string, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, surf: number, uv = 1): void {
  c.gb.box(mat, lx, ly, lz, sx, sy, sz, color, { uv });
  cbox(c, lx, lz, sx, sz, ly - sy / 2, ly + sy / 2, surf);
}
function lootAt(c: Ctx, lx: number, ly: number, lz: number, upstairs = false, tierBonus = 0): void {
  const [wx, wz] = toWorld(c, lx, lz);
  c.loot.push({ x: wx, y: c.y + ly, z: wz, building: c.bid, upstairs, tier: c.tier + tierBonus });
}
function register(c: Ctx, kind: string, w: number, d: number, doors: [number, number, number, number][]): BuildingInfo {
  const info: BuildingInfo = {
    id: c.buildings.length, kind, x: c.x, z: c.z, y: c.y, yaw: c.yaw, cos: c.cos, sin: c.sin, hx: w / 2, hz: d / 2,
    doors: doors.map(([ox, oz, ix, iz]) => {
      const o = toWorld(c, ox, oz);
      const i = toWorld(c, ix, iz);
      return { ox: o[0], oz: o[1], ix: i[0], iz: i[1] };
    }),
  };
  c.buildings.push(info);
  c.bid = info.id;
  return info;
}

const UV: Record<string, number> = { plaster: 0.45, brick: 0.8, concrete: 0.35, wood: 0.7, roof: 0.6, metal: 0.5, trim: 1, glass: 1, cloth: 1 };

interface Opening {
  /** start along the wall */
  a: number;
  w: number;
  /** sill height above the wall base */
  y: number;
  h: number;
  kind: 'door' | 'window' | 'gap';
}

/**
 * A straight wall with door / window cut-outs. `axis` is the direction the
 * wall runs in, `fixed` its position on the other axis, `out` (+1/-1) the
 * exterior side.
 */
function wall(
  c: Ctx, mat: string, color: number, surf: number, axis: 'x' | 'z', fixed: number, from: number, to: number,
  y0: number, h: number, th: number, openings: Opening[], out: number, trim: number,
): void {
  const gb = c.gb;
  const uv = UV[mat] ?? 1;
  const piece = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 < 0.02 || v1 - v0 < 0.02) return;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    if (axis === 'x') {
      gb.box(mat, cu, cv, fixed, u1 - u0, v1 - v0, th, color, { uv });
      cbox(c, cu, fixed, u1 - u0, th, v0, v1, surf);
    } else {
      gb.box(mat, fixed, cv, cu, th, v1 - v0, u1 - u0, color, { uv });
      cbox(c, fixed, cu, th, u1 - u0, v0, v1, surf);
    }
  };
  const deco = (m: string, u: number, v: number, w: number, hh: number, depth: number, col: number, off = 0) => {
    if (axis === 'x') gb.box(m, u, v, fixed + off, w, hh, depth, col);
    else gb.box(m, fixed + off, v, u, depth, hh, w, col);
  };
  const ops = [...openings].sort((p, q) => p.a - q.a);
  let cur = from;
  for (const op of ops) {
    const s = from + op.a;
    const e = s + op.w;
    piece(cur, s, y0, y0 + h);
    piece(s, e, y0, y0 + op.y);
    piece(s, e, y0 + op.y + op.h, y0 + h);
    cur = e;
    const mid = (s + e) / 2;
    const vy = y0 + op.y + op.h / 2;
    if (op.kind === 'window') {
      const f = 0.07;
      deco('trim', mid, y0 + op.y + f / 2, op.w, f, th + 0.06, trim);
      deco('trim', mid, y0 + op.y + op.h - f / 2, op.w, f, th + 0.06, trim);
      deco('trim', s + f / 2, vy, f, op.h, th + 0.06, trim);
      deco('trim', e - f / 2, vy, f, op.h, th + 0.06, trim);
      deco('trim', mid, vy, 0.04, op.h, 0.05, trim);
      if (op.h > 0.8) deco('trim', mid, vy, op.w, 0.04, 0.05, trim);
      deco('glass', mid, vy, op.w - f * 2, op.h - f * 2, 0.02, 0xffffff);
      deco('trim', mid, y0 + op.y - 0.03, op.w + 0.16, 0.06, 0.14, trim, out * (th / 2 + 0.05));
    } else if (op.kind === 'door') {
      const f = 0.08;
      deco('trim', mid, y0 + op.y + op.h - f / 2, op.w, f, th + 0.06, trim);
      deco('trim', s + f / 2, vy, f, op.h, th + 0.06, trim);
      deco('trim', e - f / 2, vy, f, op.h, th + 0.06, trim);
      // door leaf swung open into the room
      const lw = op.w - 0.16;
      if (axis === 'x') {
        gb.box('wood', s + 0.1, vy - 0.02, fixed - out * (lw / 2 + 0.05), 0.05, op.h - 0.1, lw, 0x8a6a4a, { uv: 0.7, ry: out * 0.18 });
        gb.box('trim', s + 0.16, y0 + op.y + 1.0, fixed - out * (lw - 0.08), 0.06, 0.04, 0.12, 0x2a2a2a);
      } else {
        gb.box('wood', fixed - out * (lw / 2 + 0.05), vy - 0.02, s + 0.1, lw, op.h - 0.1, 0.05, 0x8a6a4a, { uv: 0.7, ry: -out * 0.18 });
        gb.box('trim', fixed - out * (lw - 0.08), y0 + op.y + 1.0, s + 0.16, 0.12, 0.04, 0.06, 0x2a2a2a);
      }
    }
  }
  piece(cur, to, y0, y0 + h);
}

/** pitched roof with the ridge along local X */
function gableRoof(c: Ctx, w: number, d: number, y: number, pitch: number, roofColor: number, wallMat: string, wallColor: number, mat = 'roof', ov = 0.45): number {
  const gb = c.gb;
  const s = d / 2 + ov;
  const rise = s * Math.tan(pitch);
  const drop = ov * Math.tan(pitch);
  const len = s / Math.cos(pitch);
  const th = 0.12;
  for (const sg of [1, -1]) {
    gb.box(mat, 0, y + rise / 2 - drop + 0.07, (sg * s) / 2, w + ov * 2, th, len, roofColor, { rx: sg * pitch, uv: UV[mat] ?? 0.6 });
    // fascia board
    gb.box('trim', 0, y - drop + 0.03, sg * (s - 0.02), w + ov * 2, 0.14, 0.05, 0xe9e4d8, { rx: sg * pitch });
  }
  // ridge cap
  gb.box(mat, 0, y + rise - drop + 0.1, 0, w + ov * 2 + 0.05, 0.1, 0.3, roofColor, { uv: 0.6 });
  const gh = (d / 2) * Math.tan(pitch);
  for (const sg of [1, -1]) {
    gb.push(sg * (w / 2 - 0.11), y, 0, Math.PI / 2);
    gb.gable(wallMat, 0, 0, 0, d, gh, 0.22, wallColor, UV[wallMat] ?? 1);
    gb.pop();
  }
  cbox(c, 0, 0, w, d, y, y + 0.25, SURF_WOOD);
  return rise - drop;
}

// ---------------------------------------------------------------- furniture

function table(c: Ctx, x: number, y: number, z: number, rot: number, w = 1.4, d = 0.8): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, 0.75, 0, w, 0.06, d, 0xb08a5e, { uv: 0.7 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box('wood', sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08), 0.07, 0.72, 0.07, 0x8f6c46, { uv: 0.7 });
  gb.pop();
  cbox(c, x, z, w, d, y, y + 0.78, SURF_WOOD, rot);
}
function chair(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, 0.45, 0, 0.42, 0.05, 0.42, 0x9a744c, { uv: 0.7 });
  gb.box('wood', 0, 0.75, -0.19, 0.42, 0.5, 0.04, 0x9a744c, { uv: 0.7 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box('wood', sx * 0.17, 0.22, sz * 0.17, 0.045, 0.44, 0.045, 0x7c5a3a, { uv: 0.7 });
  gb.pop();
}
function bed(c: Ctx, x: number, y: number, z: number, rot: number, blanket: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, 0.2, 0, 2.05, 0.3, 1.0, 0x7a5638, { uv: 0.7 });
  gb.box('wood', -1.0, 0.5, 0, 0.07, 0.9, 1.0, 0x7a5638, { uv: 0.7 });
  gb.box('cloth', 0.02, 0.43, 0, 1.92, 0.18, 0.92, 0xe8e4da);
  gb.box('cloth', 0.3, 0.5, 0, 1.3, 0.1, 0.96, blanket);
  gb.box('cloth', -0.72, 0.56, 0, 0.34, 0.1, 0.6, 0xf4f1ea);
  gb.pop();
  cbox(c, x, z, 2.05, 1.0, y, y + 0.55, SURF_WOOD, rot);
}
function wardrobe(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, 1.0, 0, 1.2, 2.0, 0.55, 0x6b4a30, { uv: 0.7 });
  gb.box('trim', 0, 1.0, 0.28, 0.02, 1.86, 0.02, 0x3a2a1c);
  gb.box('trim', -0.08, 1.0, 0.29, 0.03, 0.14, 0.03, 0xc8b070);
  gb.box('trim', 0.08, 1.0, 0.29, 0.03, 0.14, 0.03, 0xc8b070);
  gb.box('wood', 0, 2.03, 0, 1.28, 0.06, 0.6, 0x5a3e28, { uv: 0.7 });
  gb.pop();
  cbox(c, x, z, 1.2, 0.55, y, y + 2.0, SURF_WOOD, rot);
}
function shelf(c: Ctx, x: number, y: number, z: number, rot: number, metal = false): void {
  const gb = c.gb;
  const rng = c.rng;
  const mat = metal ? 'trim' : 'wood';
  const col = metal ? 0x6f7780 : 0x94704a;
  const w = metal ? 2.4 : 1.5;
  const h = metal ? 2.4 : 1.8;
  const d = metal ? 0.7 : 0.36;
  gb.push(x, y, z, rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box(mat, sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03), 0.06, h, 0.06, col);
  const levels = metal ? 3 : 4;
  for (let k = 0; k < levels; k++) {
    const ly = 0.12 + (k * (h - 0.25)) / (levels - 1);
    gb.box(mat, 0, ly, 0, w, 0.04, d, col);
    if (k < levels - 1) {
      let px = -w / 2 + 0.2;
      while (px < w / 2 - 0.25) {
        const bw = rrange(rng, 0.12, metal ? 0.6 : 0.3);
        const bh = rrange(rng, 0.14, metal ? 0.5 : 0.3);
        if (rng() < 0.75) {
          const colr = rpick(rng, [0x9c4a3a, 0x3f6a8a, 0xc9a54a, 0x587a4a, 0x8a8f96, 0xb07a4a, 0x4a4f6a]);
          gb.box(metal && bw > 0.3 ? 'wood' : 'cloth', px + bw / 2, ly + 0.02 + bh / 2, rrange(rng, -0.05, 0.05), bw, bh, d * 0.7, colr, { uv: 1 });
        }
        px += bw + rrange(rng, 0.03, 0.2);
      }
    }
  }
  gb.pop();
  cbox(c, x, z, w, d, y, y + h, metal ? SURF_METAL : SURF_WOOD, rot);
}
function counter(c: Ctx, x: number, y: number, z: number, rot: number, w = 2.2): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, 0.44, 0, w, 0.88, 0.6, 0xd8d2c4, { uv: 0.7 });
  gb.box('trim', 0, 0.9, 0, w + 0.04, 0.05, 0.66, 0x3c3f44);
  for (let k = 0; k < Math.floor(w / 0.55); k++) gb.box('trim', -w / 2 + 0.3 + k * 0.55, 0.6, 0.31, 0.12, 0.02, 0.02, 0x9a9a9a);
  gb.box('trim', w * 0.2, 0.94, 0, 0.5, 0.03, 0.38, 0x8f969c);
  gb.pop();
  cbox(c, x, z, w, 0.6, y, y + 0.92, SURF_WOOD, rot);
}
function sofa(c: Ctx, x: number, y: number, z: number, rot: number, color: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('cloth', 0, 0.25, 0, 1.9, 0.34, 0.85, color);
  gb.box('cloth', 0, 0.62, -0.33, 1.9, 0.5, 0.2, color);
  gb.box('cloth', -0.9, 0.42, 0, 0.18, 0.58, 0.85, color);
  gb.box('cloth', 0.9, 0.42, 0, 0.18, 0.58, 0.85, color);
  gb.box('cloth', -0.42, 0.46, 0.04, 0.78, 0.12, 0.6, 0xd9d2c2);
  gb.box('cloth', 0.42, 0.46, 0.04, 0.78, 0.12, 0.6, 0xd9d2c2);
  gb.pop();
  cbox(c, x, z, 1.9, 0.85, y, y + 0.7, SURF_WOOD, rot);
}
function rug(c: Ctx, x: number, y: number, z: number, rot: number, w: number, d: number, color: number): void {
  c.gb.push(x, y, z, rot);
  c.gb.box('cloth', 0, 0.012, 0, w, 0.02, d, color);
  c.gb.box('cloth', 0, 0.016, 0, w - 0.3, 0.02, d - 0.3, 0xd8cdb8);
  c.gb.box('cloth', 0, 0.02, 0, w - 0.6, 0.02, d - 0.6, color);
  c.gb.pop();
}

// -------------------------------------------------------------------- props

export function crate(c: Ctx, x: number, y: number, z: number, rot: number, s = 1, color = 0xa98458): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('wood', 0, s / 2, 0, s, s, s, color, { uv: 0.9 });
  const t = 0.07 * s;
  const e = s / 2 + 0.012;
  const dark = 0x6f5134;
  for (const sg of [-1, 1]) {
    // frame on the four vertical faces + top
    for (const a of [-1, 1]) {
      gb.box('wood', a * (s / 2 - t / 2), s / 2, sg * e, t, s, 0.03, dark, { uv: 0.9 });
      gb.box('wood', sg * e, s / 2, a * (s / 2 - t / 2), 0.03, s, t, dark, { uv: 0.9 });
      gb.box('wood', 0, s / 2 + a * (s / 2 - t / 2), sg * e, s, t, 0.03, dark, { uv: 0.9 });
      gb.box('wood', sg * e, s / 2 + a * (s / 2 - t / 2), 0, 0.03, t, s, dark, { uv: 0.9 });
    }
    gb.box('wood', 0, s / 2, sg * e, t, s * 1.3, 0.025, dark, { uv: 0.9, rz: 0.785 });
  }
  gb.pop();
  cbox(c, x, z, s, s, y, y + s, SURF_WOOD, rot);
}
export function barrel(c: Ctx, x: number, y: number, z: number, color = 0x3e6a8c): void {
  const gb = c.gb;
  gb.push(x, y, z, 0);
  gb.cyl('trim', 0, 0.45, 0, 0.3, 0.3, 0.9, color, 14);
  for (const ry of [0.06, 0.45, 0.84]) gb.cyl('trim', 0, ry, 0, 0.315, 0.315, 0.04, 0x2d3a44, 14);
  gb.cyl('trim', 0, 0.9, 0, 0.27, 0.27, 0.01, 0x55626c, 14);
  gb.pop();
  ccyl(c, x, z, 0.31, y, y + 0.9, SURF_METAL);
}
export function sandbags(c: Ctx, x: number, y: number, z: number, rot: number, len = 3, rows = 3): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  const n = Math.round(len / 0.62);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < n - (r % 2); k++) {
      const px = -len / 2 + 0.31 + k * 0.62 + (r % 2) * 0.31;
      const shade = 0x9c8a66 + ((k * 3 + r * 5) % 3) * 0x050505;
      gb.sphere('cloth', px, 0.15 + r * 0.27, (k % 2) * 0.03, 0.34, shade, 1, 0.46, 0.68, 7);
    }
  }
  gb.pop();
  cbox(c, x, z, len, 0.5, y, y + rows * 0.27 + 0.06, SURF_DIRT, rot);
}
export function barrier(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.box('concrete', 0, 0.12, 0, 2.4, 0.24, 0.62, 0xc9c6bd, { uv: 0.35 });
  gb.box('concrete', 0, 0.36, 0, 2.4, 0.26, 0.42, 0xc9c6bd, { uv: 0.35 });
  gb.box('concrete', 0, 0.72, 0, 2.4, 0.5, 0.24, 0xc9c6bd, { uv: 0.35 });
  gb.box('trim', 0, 0.8, 0.125, 2.4, 0.14, 0.01, 0xd9a520);
  gb.box('trim', 0, 0.8, -0.125, 2.4, 0.14, 0.01, 0xd9a520);
  gb.pop();
  cbox(c, x, z, 2.4, 0.5, y, y + 0.97, SURF_CONCRETE, rot);
}
export function container(c: Ctx, x: number, y: number, z: number, rot: number, color: number, open: boolean): void {
  const gb = c.gb;
  const L = 6.1;
  const W = 2.44;
  const H = 2.6;
  gb.push(x, y, z, rot);
  const t = 0.07;
  if (!open) {
    gb.box('metal', 0, H / 2, 0, L, H, W, color, { uv: 1 });
    cbox(c, x, z, L, W, y, y + H, SURF_METAL, rot);
  } else {
    gb.box('metal', 0, H / 2, W / 2 - t / 2, L, H, t, color, { uv: 1 });
    gb.box('metal', 0, H / 2, -W / 2 + t / 2, L, H, t, color, { uv: 1 });
    gb.box('metal', -L / 2 + t / 2, H / 2, 0, t, H, W, color, { uv: 1 });
    gb.box('metal', 0, H - t / 2, 0, L, t, W, color, { uv: 1 });
    gb.box('wood', 0, 0.06, 0, L, 0.12, W, 0x7a6248, { uv: 0.7 });
    // doors swung open
    gb.box('metal', L / 2 + 0.55, H / 2, W / 2 + 0.25, 1.2, H - 0.1, t, color, { uv: 1, ry: -0.5 });
    gb.box('metal', L / 2 + 0.55, H / 2, -W / 2 - 0.25, 1.2, H - 0.1, t, color, { uv: 1, ry: 0.5 });
    gb.pop();
    const add = (lx: number, lz: number, sx: number, sz: number, y0: number, y1: number) => {
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      cbox(c, x + lx * cs + lz * sn, z - lx * sn + lz * cs, sx, sz, y + y0, y + y1, SURF_METAL, rot);
    };
    add(0, W / 2 - t / 2, L, t + 0.06, 0, H);
    add(0, -W / 2 + t / 2, L, t + 0.06, 0, H);
    add(-L / 2 + t / 2, 0, t + 0.06, W, 0, H);
    add(0, 0, L, W, H - 0.1, H);
    add(0, 0, L, W, -0.5, 0.12);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const [wx, wz] = toWorld(c, x + -1.2 * cs, z - -1.2 * sn);
    c.loot.push({ x: wx, y: c.y + y + 0.14, z: wz, building: -1, upstairs: false, tier: c.tier + 1 });
    gb.push(x, y, z, rot);
  }
  // frame + details
  const dark = 0x2c3034;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    gb.box('trim', sx * (L / 2 - 0.06), H / 2, sz * (W / 2 - 0.06), 0.14, H + 0.04, 0.14, dark);
  }
  for (const sz of [-1, 1]) {
    gb.box('trim', 0, H - 0.05, sz * (W / 2 - 0.05), L, 0.12, 0.12, dark);
    gb.box('trim', 0, 0.06, sz * (W / 2 - 0.05), L, 0.12, 0.12, dark);
  }
  if (!open) {
    for (const k of [-0.75, -0.25, 0.25, 0.75]) gb.cyl('trim', L / 2 + 0.03, H / 2, k, 0.025, 0.025, H - 0.3, 0xb8bcc0, 6);
    gb.box('trim', L / 2 + 0.02, H / 2, 0, 0.02, H - 0.2, 0.03, dark);
  }
  gb.pop();
}
export function fence(c: Ctx, x: number, y: number, z: number, rot: number, len: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let k = 0; k < posts; k++) {
    const px = -len / 2 + (k * len) / (posts - 1);
    gb.box('wood', px, 0.55, 0, 0.1, 1.15, 0.1, 0x8a6e50, { uv: 0.7 });
  }
  gb.box('wood', 0, 0.9, 0.02, len, 0.1, 0.04, 0x9a7c5a, { uv: 0.7 });
  gb.box('wood', 0, 0.5, 0.02, len, 0.1, 0.04, 0x9a7c5a, { uv: 0.7 });
  gb.pop();
  cbox(c, x, z, len, 0.14, y, y + 1.05, SURF_WOOD, rot);
}
export function hayBale(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.cyl('cloth', 0, 0.68, 0, 0.7, 0.7, 1.3, 0xc9a94e, 14, { rz: Math.PI / 2 });
  gb.cyl('cloth', 0.66, 0.68, 0, 0.5, 0.5, 0.01, 0xb08f3a, 12, { rz: Math.PI / 2 });
  gb.cyl('cloth', -0.66, 0.68, 0, 0.5, 0.5, 0.01, 0xb08f3a, 12, { rz: Math.PI / 2 });
  gb.pop();
  cbox(c, x, z, 1.3, 1.2, y, y + 1.3, SURF_DIRT, rot);
}
export function lampPost(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.cyl('trim', 0, 2.6, 0, 0.05, 0.08, 5.2, 0x3a4046, 8);
  gb.cyl('trim', 0, 0.15, 0, 0.12, 0.14, 0.3, 0x2d3236, 8);
  gb.box('trim', 0.5, 5.15, 0, 1.1, 0.06, 0.06, 0x3a4046);
  gb.box('trim', 1.0, 5.08, 0, 0.5, 0.1, 0.2, 0x2d3236);
  gb.box('emissive', 1.0, 5.02, 0, 0.4, 0.03, 0.14, 0xfff2c0);
  gb.pop();
  ccyl(c, x, z, 0.1, y, y + 5.2, SURF_METAL);
}
export function powerPole(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  gb.cyl('wood', 0, 3.6, 0, 0.09, 0.14, 7.2, 0x6a5440, 8);
  gb.box('wood', 0, 6.7, 0, 1.8, 0.1, 0.1, 0x5c4836);
  gb.box('wood', 0, 6.1, 0, 1.3, 0.1, 0.1, 0x5c4836);
  for (const sx of [-0.8, -0.3, 0.3, 0.8]) gb.cyl('trim', sx, 6.82, 0, 0.03, 0.04, 0.14, 0x9fb0b8, 6);
  gb.pop();
  ccyl(c, x, z, 0.13, y, y + 7.2, SURF_WOOD);
}
export function logPile(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  const rows = [4, 3, 2];
  rows.forEach((n, r) => {
    for (let k = 0; k < n; k++) {
      const px = (k - (n - 1) / 2) * 0.52;
      gb.cyl('wood', px, 0.26 + r * 0.45, 0, 0.25, 0.26, 3.6, 0x7d5f42, 9, { rx: Math.PI / 2, uv: 0.7 });
      for (const e of [-1.81, 1.81]) gb.cyl('trim', px, 0.26 + r * 0.45, e, 0.24, 0.24, 0.01, 0xc9a877, 9, { rx: Math.PI / 2 });
    }
  });
  gb.pop();
  cbox(c, x, z, 2.1, 3.6, y, y + 0.55, SURF_WOOD, rot);
  cbox(c, x, z, 1.5, 3.6, y, y + 1.0, SURF_WOOD, rot);
  cbox(c, x, z, 1.0, 3.6, y, y + 1.4, SURF_WOOD, rot);
}
export function tires(c: Ctx, x: number, y: number, z: number, n = 3): void {
  const gb = c.gb;
  gb.push(x, y, z, 0);
  for (let k = 0; k < n; k++) {
    gb.cyl('trim', (k % 2) * 0.04, 0.12 + k * 0.23, 0, 0.36, 0.36, 0.22, 0x1c1d1f, 12);
    gb.cyl('trim', (k % 2) * 0.04, 0.13 + k * 0.23, 0, 0.2, 0.2, 0.225, 0x0c0c0d, 10);
  }
  gb.pop();
  ccyl(c, x, z, 0.36, y, y + n * 0.23, SURF_DIRT);
}
export function well(c: Ctx, x: number, y: number, z: number): void {
  const gb = c.gb;
  gb.push(x, y, z, 0);
  gb.cyl('brick', 0, 0.45, 0, 0.95, 1.0, 0.9, 0xb9b3a8, 14, { uv: 0.8 });
  gb.cyl('trim', 0, 0.86, 0, 0.75, 0.75, 0.06, 0x12222c, 14);
  for (const sx of [-0.85, 0.85]) gb.box('wood', sx, 1.45, 0, 0.12, 2.1, 0.12, 0x6e553c, { uv: 0.7 });
  gb.box('roof', 0, 2.62, 0.42, 2.2, 0.08, 1.1, 0x7a3b2c, { rx: 0.55, uv: 0.6 });
  gb.box('roof', 0, 2.62, -0.42, 2.2, 0.08, 1.1, 0x7a3b2c, { rx: -0.55, uv: 0.6 });
  gb.cyl('wood', 0, 2.1, 0, 0.07, 0.07, 1.7, 0x5c4630, 8, { rz: Math.PI / 2 });
  gb.pop();
  ccyl(c, x, z, 1.0, y, y + 0.92, SURF_CONCRETE);
}

/** burnt-out civilian car */
export function car(c: Ctx, x: number, y: number, z: number, rot: number, color: number, pickup = false): void {
  const gb = c.gb;
  gb.push(x, y, z, rot);
  const L = pickup ? 4.9 : 4.3;
  const W = 1.8;
  const dark = 0x18191b;
  // chassis & body
  gb.box('trim', 0, 0.36, 0, L - 0.5, 0.22, W - 0.16, dark);
  gb.box('paint', 0, 0.72, 0, L, 0.52, W, color);
  gb.box('paint', L / 2 - 0.5, 1.0, 0, 1.0, 0.09, W - 0.08, color, { rz: -0.07 });
  // cabin
  const cabX = pickup ? 0.35 : -0.25;
  const cabL = pickup ? 1.6 : 2.2;
  gb.box('paint', cabX, 1.56, 0, cabL - 0.5, 0.08, W - 0.3, color);
  for (const sz of [-1, 1]) {
    gb.box('paint', cabX - cabL / 2 + 0.2, 1.27, sz * (W / 2 - 0.12), 0.09, 0.62, 0.08, color, { rz: 0.32 });
    gb.box('paint', cabX + cabL / 2 - 0.25, 1.27, sz * (W / 2 - 0.12), 0.09, 0.66, 0.08, color, { rz: -0.5 });
    gb.box('paint', cabX, 1.27, sz * (W / 2 - 0.12), 0.07, 0.56, 0.07, color);
    gb.box('glass', cabX, 1.27, sz * (W / 2 - 0.13), cabL - 0.5, 0.48, 0.02, 0xffffff);
    // door seams & handles
    gb.box('trim', cabX - 0.05, 0.8, sz * (W / 2 + 0.005), 0.015, 0.5, 0.01, dark);
    gb.box('trim', cabX + 0.35, 0.9, sz * (W / 2 + 0.01), 0.14, 0.03, 0.02, 0xa8acb0);
    gb.box('trim', cabX + cabL / 2 - 0.1, 1.08, sz * (W / 2 + 0.1), 0.06, 0.1, 0.16, color);
  }
  gb.box('glass', cabX + cabL / 2 - 0.22, 1.28, 0, 0.03, 0.62, W - 0.34, 0xffffff, { rz: -0.5 });
  gb.box('glass', cabX - cabL / 2 + 0.2, 1.28, 0, 0.03, 0.58, W - 0.34, 0xffffff, { rz: 0.32 });
  if (pickup) {
    for (const sz of [-1, 1]) gb.box('paint', -1.45, 1.1, sz * (W / 2 - 0.05), 1.9, 0.3, 0.08, color);
    gb.box('paint', -2.4, 1.1, 0, 0.08, 0.3, W, color);
    gb.box('trim', -1.45, 0.97, 0, 1.9, 0.04, W - 0.18, 0x2a2c2e);
  } else {
    gb.box('paint', -L / 2 + 0.45, 1.0, 0, 0.9, 0.08, W - 0.08, color, { rz: 0.05 });
  }
  // bumpers, grille, lights
  gb.box('trim', L / 2 + 0.03, 0.55, 0, 0.12, 0.2, W + 0.04, 0x2a2c2e);
  gb.box('trim', -L / 2 - 0.03, 0.55, 0, 0.12, 0.2, W + 0.04, 0x2a2c2e);
  gb.box('trim', L / 2 + 0.01, 0.82, 0, 0.03, 0.2, 0.9, dark);
  for (const sz of [-1, 1]) {
    gb.box('trim', L / 2 + 0.01, 0.84, sz * 0.68, 0.03, 0.16, 0.3, 0xe8e6da);
    gb.box('trim', -L / 2 - 0.01, 0.86, sz * 0.68, 0.03, 0.14, 0.28, 0x8a1c14);
  }
  // wheels
  for (const sx of [L / 2 - 0.85, -L / 2 + 0.8]) for (const sz of [-1, 1]) {
    gb.cyl('trim', sx, 0.34, sz * (W / 2 - 0.08), 0.34, 0.34, 0.24, 0x151517, 14, { rx: Math.PI / 2 });
    gb.cyl('trim', sx, 0.34, sz * (W / 2 + 0.045), 0.19, 0.19, 0.02, 0x8d9197, 10, { rx: Math.PI / 2 });
    gb.box('paint', sx, 0.74, sz * (W / 2 + 0.01), 0.86, 0.1, 0.06, color);
  }
  gb.pop();
  cbox(c, x, z, L, W, y + 0.1, y + 1.02, SURF_METAL, rot);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  cbox(c, x + cabX * cs, z - cabX * sn, cabL - 0.3, W - 0.2, y + 1.0, y + 1.6, SURF_METAL, rot);
}

export function tent(c: Ctx, x: number, y: number, z: number, rot: number, color = 0x5d6a48): void {
  const gb = c.gb;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  gb.push(x, y, z, rot);
  const W = 3.6;
  const L = 5;
  const p = 0.72;
  const len = W / 2 / Math.cos(p);
  for (const sg of [1, -1]) gb.box('cloth', 0, (Math.tan(p) * W) / 4 + 0.75, (sg * W) / 4, L, 0.04, len, color, { rx: sg * p });
  for (const sg of [1, -1]) gb.box('cloth', 0, 0.38, sg * (W / 2), L, 0.76, 0.04, color);
  for (const sx of [-L / 2, 0, L / 2]) gb.cyl('wood', sx, 1.15, 0, 0.04, 0.04, 2.3, 0x6e553c, 6);
  gb.box('cloth', -L / 2, 0.38, 0, 0.04, 0.76, W, color);
  gb.push(-L / 2, 0.76, 0, Math.PI / 2);
  gb.gable('cloth', 0, 0, 0, W, Math.tan(p) * (W / 2), 0.04, color);
  gb.pop();
  gb.box('cloth', 0.6, 0.2, -1.0, 1.9, 0.12, 0.7, 0x76806a);
  gb.box('cloth', 0.6, 0.2, 1.0, 1.9, 0.12, 0.7, 0x76806a);
  gb.pop();
  const add = (lx: number, lz: number, sx: number, sz: number, y1: number) => cbox(c, x + lx * cs + lz * sn, z - lx * sn + lz * cs, sx, sz, y, y + y1, SURF_DIRT, rot);
  add(0, W / 2, L, 0.12, 1.5);
  add(0, -W / 2, L, 0.12, 1.5);
  add(-L / 2, 0, 0.12, W, 2.2);
  const [wx, wz] = toWorld(c, x + -1.0 * cs, z - -1.0 * sn);
  c.loot.push({ x: wx, y: c.y + y + 0.03, z: wz, building: -1, upstairs: false, tier: c.tier + 1 });
}

export function watchTower(c: Ctx, x: number, y: number, z: number, rot: number): void {
  const gb = c.gb;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  gb.push(x, y, z, rot);
  const H = 6.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    gb.box('wood', sx * 1.25, H / 2, sz * 1.25, 0.18, H, 0.18, 0x6a533c, { uv: 0.7 });
    cbox(c, x + sx * 1.25 * cs + sz * 1.25 * sn, z - sx * 1.25 * sn + sz * 1.25 * cs, 0.2, 0.2, y, y + H, SURF_WOOD, rot);
  }
  for (const hy of [1.6, 3.6]) {
    for (const sg of [-1, 1]) {
      gb.box('wood', 0, hy, sg * 1.25, 2.9, 0.1, 0.08, 0x7a6046, { uv: 0.7, rz: sg * 0.6 });
      gb.box('wood', sg * 1.25, hy, 0, 0.08, 0.1, 2.9, 0x7a6046, { uv: 0.7, rx: sg * 0.6 });
    }
  }
  gb.box('wood', 0, H + 0.06, 0, 3.4, 0.12, 3.4, 0x8a6e50, { uv: 0.7 });
  for (const sg of [-1, 1]) {
    gb.box('wood', 0, H + 0.65, sg * 1.65, 3.4, 1.0, 0.06, 0x7d6248, { uv: 0.7 });
    gb.box('wood', sg * 1.65, H + 0.65, 0, 0.06, 1.0, 3.4, 0x7d6248, { uv: 0.7 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box('wood', sx * 1.6, H + 1.4, sz * 1.6, 0.1, 2.6, 0.1, 0x6a533c, { uv: 0.7 });
  gb.box('metal', 0, H + 2.85, 0.9, 3.9, 0.06, 2.1, 0x6f7a80, { rx: 0.25, uv: 0.5 });
  gb.box('metal', 0, H + 2.85, -0.9, 3.9, 0.06, 2.1, 0x6f7a80, { rx: -0.25, uv: 0.5 });
  // ladder
  for (const sx of [-0.22, 0.22]) gb.box('wood', sx, H / 2, 1.42, 0.05, H, 0.05, 0x8a6e50, { uv: 0.7 });
  for (let k = 0; k < 15; k++) gb.box('wood', 0, 0.3 + k * 0.4, 1.42, 0.5, 0.04, 0.04, 0x8a6e50, { uv: 0.7 });
  gb.pop();
}

// ---------------------------------------------------------------- buildings

const WALL_COLORS = [0xe9e2d2, 0xdccdb0, 0xcfd8da, 0xe6d6c6, 0xc6cfb8, 0xf1eee6, 0xd8c3a6, 0xbfcad6];
const ROOF_COLORS = [0x9a4a36, 0x565c66, 0x7a5644, 0x4c6656, 0x8a5a44, 0x3f4650];
const BLANKETS = [0x7a3b3b, 0x3b5a7a, 0x4f6f4a, 0x8a6a2e, 0x5a4a7a];

function foundation(c: Ctx, w: number, d: number, top = 0.2): void {
  c.gb.box('concrete', 0, top - 0.9, 0, w + 0.3, 1.8, d + 0.3, 0xb5b1a8, { uv: 0.35, skip: 'b' });
  cbox(c, 0, 0, w + 0.3, d + 0.3, top - 1.8, top, SURF_CONCRETE);
}
function floorBoards(c: Ctx, w: number, d: number, y: number, color = 0xb89a72): void {
  c.gb.box('wood', 0, y + 0.012, 0, w - 0.24, 0.024, d - 0.24, color, { uv: 0.55, skip: 'b' });
}

export function house(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const rng = c.rng;
  const W = 8.4;
  const D = 6.6;
  begin(c, x, y, z, yaw);
  const doorX = rpick(rng, [-1.6, 0, 1.4]);
  register(c, 'house', W, D, [[doorX, D / 2 + 1.5, doorX, D / 2 - 1.1]]);
  const wc = rpick(rng, WALL_COLORS);
  const rc = rpick(rng, ROOF_COLORS);
  const brick = rng() < 0.3;
  const mat = brick ? 'brick' : 'plaster';
  const col = brick ? 0xffffff : wc;
  const trim = rng() < 0.6 ? 0xf2efe8 : 0x4a3a2c;
  const F = 0.2;
  const H = 2.7;
  const th = 0.22;
  foundation(c, W, D, F);
  floorBoards(c, W, D, F);
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  const win = (a: number, w = 1.3): Opening => ({ a, w, y: 0.9, h: 1.15, kind: 'window' });
  const fr: Opening[] = [{ a: W / 2 + doorX - 0.55, w: 1.1, y: 0, h: 2.1, kind: 'door' }];
  if (doorX > -1) fr.push(win(0.9));
  if (doorX < 1) fr.push(win(W - 2.2));
  wall(c, mat, col, SURF_CONCRETE, 'x', wz, -W / 2, W / 2, F, H, th, fr, 1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'x', -wz, -W / 2, W / 2, F, H, th, [win(1.2), win(W - 2.5)], -1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'z', wx, -D / 2 + th, D / 2 - th, F, H, th, [win(D / 2 - th - 0.65)], 1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'z', -wx, -D / 2 + th, D / 2 - th, F, H, th, [win(D / 2 - th - 0.65)], -1, trim);
  // ceiling + roof
  c.gb.box('plaster', 0, F + H + 0.06, 0, W, 0.12, D, 0xf0ede6, { uv: 0.45 });
  const rise = gableRoof(c, W, D, F + H + 0.12, 0.6, rc, mat, col);
  // chimney
  const chx = rpick(rng, [-2.4, 2.4]);
  c.gb.box('brick', chx, F + H + rise * 0.6 + 0.6, -1.0, 0.6, rise * 0.8 + 1.4, 0.6, 0xffffff, { uv: 0.8 });
  c.gb.box('concrete', chx, F + H + rise + 1.33, -1.0, 0.72, 0.08, 0.72, 0xa9a59c, { uv: 0.35 });
  // porch
  c.gb.box('concrete', doorX, 0.08, D / 2 + 0.6, 1.9, 0.16, 1.2, 0xbdb9af, { uv: 0.35 });
  cbox(c, doorX, D / 2 + 0.6, 1.9, 1.2, -0.5, 0.16, SURF_CONCRETE);
  c.gb.box('roof', doorX, 2.55, D / 2 + 0.6, 2.1, 0.07, 1.3, rc, { rx: 0.2, uv: 0.6 });
  for (const sx of [-0.9, 0.9]) c.gb.box('wood', doorX + sx, 1.32, D / 2 + 1.1, 0.09, 2.3, 0.09, 0xe9e4d8, { uv: 0.7 });
  // interior
  const blanket = rpick(rng, BLANKETS);
  bed(c, -W / 2 + 1.35, F, -D / 2 + 0.85, 0, blanket);
  wardrobe(c, -W / 2 + 0.55, F, 0.4, Math.PI / 2);
  table(c, 1.9, F, -1.2, 0);
  chair(c, 1.5, F, -0.55, Math.PI);
  chair(c, 2.4, F, -1.85, 0);
  counter(c, W / 2 - 1.5, F, -D / 2 + 0.52, 0);
  sofa(c, W / 2 - 0.75, F, 1.0, -Math.PI / 2, rpick(rng, [0x6a5a4a, 0x4a5a6a, 0x7a4a3a, 0x5a6a4a]));
  rug(c, 0.6, F + 0.02, 0.9, 0, 2.6, 1.7, rpick(rng, [0x7a3030, 0x30507a, 0x6a5a30]));
  shelf(c, -1.5, F, -D / 2 + 0.42, 0);
  lootAt(c, -1.6, F + 0.03, 0.6);
  lootAt(c, 0.3, F + 0.03, -1.6);
  lootAt(c, 2.6, F + 0.03, 1.2);
  if (rng() < 0.6) lootAt(c, -W / 2 + 1.5, F + 0.03, 1.9);
  end(c);
}

export function house2(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const rng = c.rng;
  const W = 9.2;
  const D = 7.4;
  begin(c, x, y, z, yaw);
  const doorX = 1.6;
  const info = register(c, 'house2', W, D, [[doorX, D / 2 + 1.5, doorX, D / 2 - 1.1]]);
  const wc = rpick(rng, WALL_COLORS);
  const rc = rpick(rng, ROOF_COLORS);
  const brickBase = rng() < 0.45;
  const trim = rng() < 0.6 ? 0xf2efe8 : 0x4a3a2c;
  const F = 0.2;
  const H1 = 2.8;
  const F2 = F + H1 + 0.2;
  const H2 = 2.6;
  const th = 0.22;
  foundation(c, W, D, F);
  floorBoards(c, W, D, F);
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  const win = (a: number, w = 1.3): Opening => ({ a, w, y: 0.9, h: 1.2, kind: 'window' });
  const m1 = brickBase ? 'brick' : 'plaster';
  const c1 = brickBase ? 0xffffff : wc;
  // ground floor
  wall(c, m1, c1, SURF_CONCRETE, 'x', wz, -W / 2, W / 2, F, H1, th, [{ a: W / 2 + doorX - 0.55, w: 1.1, y: 0, h: 2.1, kind: 'door' }, win(1.0, 1.6)], 1, trim);
  wall(c, m1, c1, SURF_CONCRETE, 'x', -wz, -W / 2, W / 2, F, H1, th, [win(W - 2.6)], -1, trim);
  wall(c, m1, c1, SURF_CONCRETE, 'z', wx, -D / 2 + th, D / 2 - th, F, H1, th, [win(D / 2 - th - 0.65)], 1, trim);
  wall(c, m1, c1, SURF_CONCRETE, 'z', -wx, -D / 2 + th, D / 2 - th, F, H1, th, [win(D - 3.0)], -1, trim);
  // stairs along the back wall
  const run = 4.6;
  const sx0 = -W / 2 + 1.5;
  const sz = -D / 2 + th + 0.6;
  const steps = 15;
  for (let k = 0; k < steps; k++) {
    const h = ((k + 1) / steps) * (F2 - F);
    c.gb.box('wood', sx0 + (k + 0.5) * (run / steps), F + h / 2, sz, run / steps, h, 1.1, 0xa98a62, { uv: 0.7 });
  }
  cbox(c, sx0 + run / 2, sz, run, 1.1, F - 0.05, F, SURF_WOOD, 0, F2);
  const sb = toWorld(c, sx0 - 0.7, sz + 0.1);
  const st = toWorld(c, sx0 + run + 0.6, sz + 0.1);
  info.stair = { bx: sb[0], bz: sb[1], tx: st[0], tz: st[1], topY: c.y + F2 };
  // upper floor slab with a stair well
  const slab = (lx0: number, lx1: number, lz0: number, lz1: number) => {
    const cx = (lx0 + lx1) / 2;
    const cz = (lz0 + lz1) / 2;
    c.gb.box('plaster', cx, F2 - 0.1, cz, lx1 - lx0, 0.2, lz1 - lz0, 0xefece4, { uv: 0.45 });
    c.gb.box('wood', cx, F2 + 0.012, cz, lx1 - lx0, 0.024, lz1 - lz0, 0xb89a72, { uv: 0.55, skip: 'b' });
    cbox(c, cx, cz, lx1 - lx0, lz1 - lz0, F2 - 0.2, F2, SURF_WOOD);
  };
  const wellZ = sz + 0.6;
  slab(-W / 2, W / 2, wellZ, D / 2);
  slab(sx0 + run, W / 2, -D / 2, wellZ);
  slab(-W / 2, sx0 - 0.05, -D / 2, wellZ);
  // railing around the stair well
  c.gb.box('wood', sx0 + run / 2 - 0.3, F2 + 0.95, wellZ + 0.03, run - 0.6, 0.07, 0.07, 0x7a5c3e, { uv: 0.7 });
  for (let k = 0; k <= 8; k++) c.gb.box('wood', sx0 + (k * (run - 0.6)) / 8, F2 + 0.47, wellZ + 0.03, 0.05, 0.95, 0.05, 0x8f6f4c, { uv: 0.7 });
  cbox(c, sx0 + run / 2 - 0.3, wellZ + 0.03, run - 0.6, 0.1, F2, F2 + 1.0, SURF_WOOD);
  // upper walls
  wall(c, 'plaster', wc, SURF_CONCRETE, 'x', wz, -W / 2, W / 2, F2, H2, th, [win(1.2), win(W - 2.6)], 1, trim);
  wall(c, 'plaster', wc, SURF_CONCRETE, 'x', -wz, -W / 2, W / 2, F2, H2, th, [win(W - 2.4)], -1, trim);
  wall(c, 'plaster', wc, SURF_CONCRETE, 'z', wx, -D / 2 + th, D / 2 - th, F2, H2, th, [win(D / 2 - th - 0.65)], 1, trim);
  wall(c, 'plaster', wc, SURF_CONCRETE, 'z', -wx, -D / 2 + th, D / 2 - th, F2, H2, th, [win(D - 3.0)], -1, trim);
  // belt course between floors
  c.gb.box('trim', 0, F2 - 0.1, D / 2 + 0.02, W + 0.1, 0.16, 0.06, trim);
  c.gb.box('trim', 0, F2 - 0.1, -D / 2 - 0.02, W + 0.1, 0.16, 0.06, trim);
  c.gb.box('trim', W / 2 + 0.02, F2 - 0.1, 0, 0.06, 0.16, D + 0.1, trim);
  c.gb.box('trim', -W / 2 - 0.02, F2 - 0.1, 0, 0.06, 0.16, D + 0.1, trim);
  c.gb.box('plaster', 0, F2 + H2 + 0.06, 0, W, 0.12, D, 0xf0ede6, { uv: 0.45 });
  const rise = gableRoof(c, W, D, F2 + H2 + 0.12, 0.62, rc, 'plaster', wc);
  c.gb.box('brick', 2.8, F2 + H2 + rise * 0.6 + 0.5, 1.0, 0.6, rise * 0.8 + 1.2, 0.6, 0xffffff, { uv: 0.8 });
  // porch
  c.gb.box('concrete', doorX, 0.08, D / 2 + 0.6, 2.2, 0.16, 1.2, 0xbdb9af, { uv: 0.35 });
  cbox(c, doorX, D / 2 + 0.6, 2.2, 1.2, -0.5, 0.16, SURF_CONCRETE);
  c.gb.box('roof', doorX, 2.6, D / 2 + 0.62, 2.4, 0.07, 1.35, rc, { rx: 0.2, uv: 0.6 });
  for (const sx of [-1.05, 1.05]) c.gb.box('wood', doorX + sx, 1.34, D / 2 + 1.14, 0.09, 2.36, 0.09, 0xe9e4d8, { uv: 0.7 });
  // ground floor furniture
  sofa(c, -1.6, F, D / 2 - 0.75, Math.PI, rpick(rng, [0x6a5a4a, 0x4a5a6a, 0x7a4a3a]));
  table(c, 2.6, F, -1.4, Math.PI / 2);
  chair(c, 1.9, F, -1.4, Math.PI / 2);
  chair(c, 3.3, F, -1.0, -Math.PI / 2);
  counter(c, W / 2 - 0.55, F, 1.2, -Math.PI / 2, 2.4);
  rug(c, -1.4, F + 0.02, 1.0, 0, 2.6, 1.8, rpick(rng, [0x7a3030, 0x30507a, 0x6a5a30]));
  shelf(c, -W / 2 + 0.42, F, 1.6, Math.PI / 2);
  lootAt(c, -2.4, F + 0.03, 0.4);
  lootAt(c, 1.4, F + 0.03, 0.6);
  lootAt(c, 3.4, F + 0.03, -2.6);
  // upper floor furniture
  bed(c, W / 2 - 1.3, F2, D / 2 - 0.85, Math.PI, rpick(rng, BLANKETS));
  bed(c, -W / 2 + 1.3, F2, D / 2 - 0.85, 0, rpick(rng, BLANKETS));
  wardrobe(c, W / 2 - 0.55, F2, -1.2, -Math.PI / 2);
  table(c, 0, F2, D / 2 - 0.7, 0, 1.2, 0.6);
  lootAt(c, 2.2, F2 + 0.03, 0.4, true, 1);
  lootAt(c, -2.6, F2 + 0.03, 0.9, true, 1);
  lootAt(c, 0.2, F2 + 0.03, 1.6, true, 1);
  if (rng() < 0.6) lootAt(c, 3.3, F2 + 0.03, -2.4, true, 1);
  end(c);
}

export function shack(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const rng = c.rng;
  const W = 4.4;
  const D = 3.8;
  begin(c, x, y, z, yaw);
  register(c, 'shack', W, D, [[0.6, D / 2 + 1.4, 0.6, D / 2 - 1.0]]);
  const col = rpick(rng, [0xa98a66, 0x8f7a60, 0xb39a78, 0x7f8a72]);
  const F = 0.15;
  const H = 2.3;
  const th = 0.14;
  c.gb.box('wood', 0, F - 0.45, 0, W + 0.1, 0.9, D + 0.1, 0x7a6046, { uv: 0.7, skip: 'b' });
  cbox(c, 0, 0, W + 0.1, D + 0.1, F - 1.2, F, SURF_WOOD);
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  wall(c, 'wood', col, SURF_WOOD, 'x', wz, -W / 2, W / 2, F, H, th, [{ a: W / 2 + 0.6 - 0.5, w: 1.0, y: 0, h: 2.0, kind: 'gap' }], 1, 0x5a4634);
  wall(c, 'wood', col, SURF_WOOD, 'x', -wz, -W / 2, W / 2, F, H, th, [{ a: 1.4, w: 1.0, y: 1.0, h: 0.8, kind: 'window' }], -1, 0x5a4634);
  wall(c, 'wood', col, SURF_WOOD, 'z', wx, -D / 2 + th, D / 2 - th, F, H, th, [], 1, 0x5a4634);
  wall(c, 'wood', col, SURF_WOOD, 'z', -wx, -D / 2 + th, D / 2 - th, F, H, th, [{ a: 1.0, w: 0.9, y: 1.0, h: 0.8, kind: 'window' }], -1, 0x5a4634);
  // mono pitch tin roof
  c.gb.box('metal', 0, F + H + 0.32, 0, W + 0.7, 0.06, D + 0.9, 0x7c868c, { rx: 0.16, uv: 0.5 });
  c.gb.box('wood', 0, F + H + 0.12, -D / 2 + 0.07, W, 0.5, 0.14, col, { uv: 0.7 });
  cbox(c, 0, 0, W, D, F + H, F + H + 0.2, SURF_METAL);
  crate(c, -W / 2 + 0.7, F, -D / 2 + 0.7, 0.2, 0.8);
  table(c, W / 2 - 0.6, F, -0.6, Math.PI / 2, 1.2, 0.6);
  lootAt(c, -0.3, F + 0.03, 0.2);
  if (rng() < 0.5) lootAt(c, 0.9, F + 0.03, -1.0);
  end(c);
}

export function shop(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const rng = c.rng;
  const W = 10.5;
  const D = 7.2;
  begin(c, x, y, z, yaw);
  register(c, 'shop', W, D, [[-3.2, D / 2 + 1.5, -3.2, D / 2 - 1.1]]);
  const F = 0.2;
  const H = 3.3;
  const th = 0.24;
  const trim = 0x2f3a44;
  const brick = rng() < 0.6;
  const mat = brick ? 'brick' : 'plaster';
  const col = brick ? 0xffffff : rpick(rng, WALL_COLORS);
  foundation(c, W, D, F);
  c.gb.box('concrete', 0, F + 0.012, 0, W - 0.24, 0.024, D - 0.24, 0xcfccc4, { uv: 0.35, skip: 'b' });
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  wall(c, mat, col, SURF_CONCRETE, 'x', wz, -W / 2, W / 2, F, H, th, [
    { a: W / 2 - 3.2 - 0.6, w: 1.2, y: 0, h: 2.2, kind: 'door' },
    { a: W / 2 - 1.6, w: 2.6, y: 0.6, h: 1.8, kind: 'window' },
    { a: W / 2 + 1.5, w: 2.6, y: 0.6, h: 1.8, kind: 'window' },
  ], 1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'x', -wz, -W / 2, W / 2, F, H, th, [{ a: W - 2.2, w: 1.0, y: 0, h: 2.1, kind: 'door' }], -1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'z', wx, -D / 2 + th, D / 2 - th, F, H, th, [], 1, trim);
  wall(c, mat, col, SURF_CONCRETE, 'z', -wx, -D / 2 + th, D / 2 - th, F, H, th, [{ a: 2.0, w: 1.4, y: 1.0, h: 1.2, kind: 'window' }], -1, trim);
  const info = c.buildings[c.bid];
  {
    const o = toWorld(c, W / 2 - 1.7, -D / 2 - 1.4);
    const i = toWorld(c, W / 2 - 1.7, -D / 2 + 1.1);
    info.doors.push({ ox: o[0], oz: o[1], ix: i[0], iz: i[1] });
  }
  // flat roof with parapet
  c.gb.box('concrete', 0, F + H + 0.1, 0, W, 0.2, D, 0xb9b6ae, { uv: 0.35 });
  cbox(c, 0, 0, W, D, F + H, F + H + 0.2, SURF_CONCRETE);
  for (const sg of [-1, 1]) {
    c.gb.box(mat, 0, F + H + 0.45, sg * (D / 2 - 0.1), W, 0.5, 0.2, col, { uv: UV[mat] });
    c.gb.box(mat, sg * (W / 2 - 0.1), F + H + 0.45, 0, 0.2, 0.5, D - 0.4, col, { uv: UV[mat] });
    c.gb.box('concrete', 0, F + H + 0.72, sg * (D / 2 - 0.1), W + 0.06, 0.06, 0.28, 0xa9a69e, { uv: 0.35 });
    c.gb.box('concrete', sg * (W / 2 - 0.1), F + H + 0.72, 0, 0.28, 0.06, D + 0.06, 0xa9a69e, { uv: 0.35 });
  }
  // awning + sign
  const awn = rpick(rng, [0xa83a2e, 0x2e6a8a, 0x3a7a4a, 0xc98a2a]);
  c.gb.box('cloth', 1.3, 2.75, D / 2 + 0.65, 6.6, 0.05, 1.4, awn, { rx: 0.3 });
  c.gb.box('trim', 0, F + H - 0.25, D / 2 + 0.03, 5.5, 0.55, 0.06, 0xe8e2d2);
  c.gb.box('trim', 0, F + H - 0.25, D / 2 + 0.065, 4.6, 0.2, 0.02, awn);
  // roof clutter
  c.gb.box('trim', 2.6, F + H + 0.6, -1.5, 1.3, 0.8, 0.9, 0x8f969c);
  c.gb.cyl('trim', 2.6, F + H + 1.05, -1.5, 0.3, 0.3, 0.1, 0x3a4046, 10);
  // interior
  counter(c, -3.2, F, -1.6, 0, 2.6);
  shelf(c, 1.0, F, -0.4, 0, true);
  shelf(c, 1.0, F, -2.2, 0, true);
  shelf(c, W / 2 - 0.5, F, 0.4, Math.PI / 2);
  shelf(c, -W / 2 + 0.5, F, -1.0, Math.PI / 2);
  crate(c, 3.9, F, 2.4, 0.3, 0.7);
  lootAt(c, -1.2, F + 0.03, 1.4);
  lootAt(c, 3.2, F + 0.03, 0.9);
  lootAt(c, -3.4, F + 0.03, -2.6, false, 1);
  lootAt(c, 1.0, F + 0.03, -1.3);
  end(c);
}

export function warehouse(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const rng = c.rng;
  const W = 19;
  const D = 12;
  begin(c, x, y, z, yaw);
  const info = register(c, 'warehouse', W, D, [[0, D / 2 + 2.0, 0, D / 2 - 1.6]]);
  const F = 0.15;
  const H = 5.4;
  const th = 0.2;
  const col = rpick(rng, [0x8fa0a8, 0xa8a08f, 0x7f8f84, 0xa0867a, 0x8a94a8]);
  c.gb.box('concrete', 0, F - 0.9, 0, W + 0.4, 1.8, D + 0.4, 0xb5b1a8, { uv: 0.35, skip: 'b' });
  cbox(c, 0, 0, W + 0.4, D + 0.4, F - 1.8, F, SURF_CONCRETE);
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  // concrete plinth + metal cladding
  const both = (axis: 'x' | 'z', fixed: number, from: number, to: number, ops: Opening[], out: number) => {
    wall(c, 'concrete', 0xc4c0b6, SURF_CONCRETE, axis, fixed, from, to, F, 1.0, th + 0.06, ops.filter((o) => o.y < 1).map((o) => ({ ...o, h: Math.min(o.h, 1.0), kind: 'gap' as const })), out, 0x3a4046);
    wall(c, 'metal', col, SURF_METAL, axis, fixed, from, to, F + 1.0, H - 1.0, th, ops.map((o) => ({ ...o, y: Math.max(0, o.y - 1.0), h: o.y < 1 ? o.h - 1.0 : o.h, kind: o.kind === 'window' ? ('window' as const) : ('gap' as const) })), out, 0x3a4046);
  };
  both('x', wz, -W / 2, W / 2, [{ a: W / 2 - 2.4, w: 4.8, y: 0, h: 4.2, kind: 'gap' }, { a: 2.0, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }, { a: W - 3.6, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }], 1);
  both('x', -wz, -W / 2, W / 2, [{ a: W - 3.2, w: 1.2, y: 0, h: 2.2, kind: 'gap' }, { a: 3, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }, { a: 8.5, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }], -1);
  both('z', wx, -D / 2 + th, D / 2 - th, [{ a: 3.0, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }, { a: 7.0, w: 1.6, y: 2.6, h: 1.0, kind: 'window' }], 1);
  both('z', -wx, -D / 2 + th, D / 2 - th, [{ a: 4.6, w: 2.4, y: 0, h: 2.6, kind: 'gap' }], -1);
  {
    const o = toWorld(c, W / 2 - 2.6, -D / 2 - 1.5);
    const i = toWorld(c, W / 2 - 2.6, -D / 2 + 1.3);
    info.doors.push({ ox: o[0], oz: o[1], ix: i[0], iz: i[1] });
    const o2 = toWorld(c, -W / 2 - 1.6, -D / 2 + th + 5.8);
    const i2 = toWorld(c, -W / 2 + 1.5, -D / 2 + th + 5.8);
    info.doors.push({ ox: o2[0], oz: o2[1], ix: i2[0], iz: i2[1] });
  }
  // sliding door leaves parked beside the opening + rail
  c.gb.box('metal', -3.7, F + 2.1, D / 2 + 0.1, 2.5, 4.2, 0.08, 0x5c666c, { uv: 0.5 });
  c.gb.box('metal', 3.7, F + 2.1, D / 2 + 0.1, 2.5, 4.2, 0.08, 0x5c666c, { uv: 0.5 });
  c.gb.box('trim', 0, F + 4.3, D / 2 + 0.1, 10.5, 0.1, 0.12, 0x2d3236);
  // roof + trusses
  const pitch = 0.2;
  const rise = gableRoof(c, W, D, F + H, pitch, 0x77828a, 'metal', col, 'metal', 0.3);
  for (let k = -3; k <= 3; k++) {
    const tx = k * 2.7;
    c.gb.box('trim', tx, F + H - 0.08, 0, 0.12, 0.16, D - 0.3, 0x3a4046);
    for (const sg of [-1, 1]) c.gb.box('trim', tx, F + H + rise / 2 - 0.12, sg * (D / 4), 0.1, 0.12, D / 2 / Math.cos(pitch), 0x3a4046, { rx: sg * pitch });
    c.gb.box('trim', tx, F + H + rise / 2 - 0.1, 0, 0.08, rise, 0.08, 0x3a4046);
  }
  // hanging lamps
  for (const lx of [-5.4, 0, 5.4]) {
    c.gb.cyl('trim', lx, F + H - 0.5, 0, 0.012, 0.012, 0.9, 0x1d1f21, 4);
    c.gb.cyl('trim', lx, F + H - 1.0, 0, 0.1, 0.3, 0.2, 0x2d3236, 10);
    c.gb.cyl('emissive', lx, F + H - 1.11, 0, 0.26, 0.26, 0.02, 0xfff0c8, 10);
  }
  // contents
  shelf(c, -W / 2 + 1.7, F, -D / 2 + 0.8, 0, true);
  shelf(c, -W / 2 + 4.6, F, -D / 2 + 0.8, 0, true);
  shelf(c, 2.0, F, -D / 2 + 0.8, 0, true);
  shelf(c, W / 2 - 0.75, F, 1.5, Math.PI / 2, true);
  crate(c, W / 2 - 1.5, F, -3.6, 0.1, 1.2);
  crate(c, W / 2 - 1.6, F + 1.2, -3.6, 0.5, 0.9);
  crate(c, W / 2 - 3.0, F, -3.3, -0.2, 1.0);
  crate(c, -5.0, F, 2.4, 0.4, 1.1);
  crate(c, -6.3, F, 3.0, 0.1, 0.9);
  crate(c, -5.6, F + 1.1, 2.6, 0.9, 0.7);
  barrel(c, -W / 2 + 1.0, F, 4.6, 0x8a3a2e);
  barrel(c, -W / 2 + 1.7, F, 4.9, 0x3e6a8c);
  barrel(c, -W / 2 + 1.2, F, 3.9, 0x4a7a4a);
  // pallets
  for (const [px, pz] of [[4.2, 3.4], [6.4, 3.0]] as const) {
    c.gb.box('wood', px, F + 0.07, pz, 1.2, 0.14, 1.0, 0xb49668, { uv: 0.7 });
    cbox(c, px, pz, 1.2, 1.0, F, F + 0.14, SURF_WOOD);
  }
  lootAt(c, -2.4, F + 0.03, -1.2, false, 1);
  lootAt(c, 3.0, F + 0.03, 0.4, false, 1);
  lootAt(c, 6.4, F + 0.17, 3.0, false, 1);
  lootAt(c, -6.8, F + 0.03, -1.6, false, 1);
  lootAt(c, 0.4, F + 0.03, -3.9, false, 1);
  lootAt(c, -3.0, F + 0.03, 3.6);
  end(c);
}

export function bunker(c: Ctx, x: number, y: number, z: number, yaw: number): void {
  const W = 7.4;
  const D = 6.2;
  begin(c, x, y, z, yaw);
  register(c, 'bunker', W, D, [[-1.8, D / 2 + 1.5, -1.8, D / 2 - 1.3]]);
  const F = 0.15;
  const H = 2.6;
  const th = 0.42;
  const col = 0xb3b0a6;
  c.gb.box('concrete', 0, F - 0.9, 0, W + 0.4, 1.8, D + 0.4, 0xa29f96, { uv: 0.35, skip: 'b' });
  cbox(c, 0, 0, W + 0.4, D + 0.4, F - 1.8, F, SURF_CONCRETE);
  const wx = W / 2 - th / 2;
  const wz = D / 2 - th / 2;
  const slit = (a: number, w = 1.7): Opening => ({ a, w, y: 1.25, h: 0.45, kind: 'gap' });
  wall(c, 'concrete', col, SURF_CONCRETE, 'x', wz, -W / 2, W / 2, F, H, th, [{ a: W / 2 - 1.8 - 0.55, w: 1.1, y: 0, h: 2.05, kind: 'gap' }, slit(W / 2 + 0.6)], 1, 0x2a2e30);
  wall(c, 'concrete', col, SURF_CONCRETE, 'x', -wz, -W / 2, W / 2, F, H, th, [slit(1.2), slit(W - 2.9)], -1, 0x2a2e30);
  wall(c, 'concrete', col, SURF_CONCRETE, 'z', wx, -D / 2 + th, D / 2 - th, F, H, th, [slit(1.8)], 1, 0x2a2e30);
  wall(c, 'concrete', col, SURF_CONCRETE, 'z', -wx, -D / 2 + th, D / 2 - th, F, H, th, [slit(1.8)], -1, 0x2a2e30);
  c.gb.box('concrete', 0, F + H + 0.2, 0, W + 0.5, 0.4, D + 0.5, 0xa9a69c, { uv: 0.35 });
  cbox(c, 0, 0, W + 0.5, D + 0.5, F + H, F + H + 0.4, SURF_CONCRETE);
  // camo netting poles + antenna
  c.gb.cyl('trim', W / 2 - 0.6, F + H + 2.0, -D / 2 + 0.6, 0.02, 0.03, 3.2, 0x2d3236, 6);
  c.gb.box('trim', W / 2 - 0.6, F + H + 0.5, -D / 2 + 0.6, 0.4, 0.3, 0.3, 0x4a5440);
  sandbags(c, -1.8 + 1.4, 0, D / 2 + 0.9, Math.PI / 2, 1.9, 3);
  // interior: ammo crates, bunk, table
  crate(c, W / 2 - 1.2, F, -D / 2 + 1.1, 0.1, 0.8, 0x56603f);
  crate(c, W / 2 - 1.3, F, -D / 2 + 2.1, -0.2, 0.7, 0x56603f);
  table(c, -W / 2 + 1.3, F, -D / 2 + 1.0, 0, 1.5, 0.7);
  bed(c, 1.2, F, D / 2 - 1.0, Math.PI, 0x4a5440);
  shelf(c, -W / 2 + 0.85, F, 1.0, Math.PI / 2, true);
  lootAt(c, 0, F + 0.03, -0.6, false, 2);
  lootAt(c, 1.6, F + 0.03, -1.6, false, 2);
  lootAt(c, -1.6, F + 0.03, 0.6, false, 2);
  end(c);
}

/** tall landmark; solid, loot around the base */
export function lighthouse(c: Ctx, x: number, y: number, z: number): void {
  const gb = c.gb;
  begin(c, x, y, z, 0);
  const H = 26;
  gb.cyl('concrete', 0, 0.5, 0, 4.6, 4.9, 1.0, 0xb9b5ab, 20, { uv: 0.35 });
  const bands = 6;
  for (let k = 0; k < bands; k++) {
    const y0 = 1.0 + (k * (H - 1)) / bands;
    const y1 = 1.0 + ((k + 1) * (H - 1)) / bands;
    const r0 = 3.6 - (y0 / H) * 1.5;
    const r1 = 3.6 - (y1 / H) * 1.5;
    gb.cyl('plaster', 0, (y0 + y1) / 2, 0, r1, r0, y1 - y0, k % 2 === 0 ? 0xf2efe8 : 0xb23a2e, 20, { uv: 0.45 });
  }
  gb.cyl('trim', 0, H + 0.15, 0, 3.1, 2.9, 0.3, 0x2d3236, 20);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    gb.cyl('trim', Math.cos(a) * 2.95, H + 0.85, Math.sin(a) * 2.95, 0.03, 0.03, 1.1, 0x2d3236, 5);
  }
  gb.cyl('trim', 0, H + 1.4, 0, 2.98, 2.98, 0.06, 0x2d3236, 20);
  gb.cyl('glass', 0, H + 1.6, 0, 1.7, 1.7, 2.6, 0xffffff, 12);
  gb.cyl('emissive', 0, H + 1.6, 0, 0.5, 0.5, 1.4, 0xfff3c2, 10);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    gb.cyl('trim', Math.cos(a) * 1.72, H + 1.6, Math.sin(a) * 1.72, 0.05, 0.05, 2.6, 0x2d3236, 5);
  }
  gb.cyl('roof', 0, H + 3.7, 0, 0.1, 2.1, 1.6, 0xa8362a, 12, { uv: 0.6 });
  gb.sphere('trim', 0, H + 4.6, 0, 0.22, 0x2d3236);
  // door + windows
  gb.box('wood', 0, 2.0, 3.45, 1.2, 2.2, 0.2, 0x5a4030, { uv: 0.7 });
  gb.box('trim', 0, 3.2, 3.42, 1.5, 0.14, 0.3, 0x2d3236);
  for (const wy of [8, 14, 20]) gb.box('trim', 0, wy, 3.6 - (wy / H) * 1.5 - 0.02, 0.7, 1.1, 0.16, 0x1d2a34);
  ccyl(c, 0, 0, 4.8, -2, 1.0, SURF_CONCRETE);
  ccyl(c, 0, 0, 3.5, 0, H + 4, SURF_CONCRETE);
  for (let k = 0; k < 5; k++) {
    const a = 0.6 + k * 1.2;
    lootAt(c, Math.cos(a) * 4.1, 1.03, Math.sin(a) * 4.1, false, 2);
  }
  end(c);
}

export function radioMast(c: Ctx, x: number, y: number, z: number): void {
  const gb = c.gb;
  begin(c, x, y, z, 0.3);
  const H = 34;
  gb.box('concrete', 0, 0.2, 0, 4.4, 0.6, 4.4, 0xb5b1a8, { uv: 0.35 });
  cbox(c, 0, 0, 4.4, 4.4, -1.5, 0.5, SURF_CONCRETE);
  const segs = 10;
  for (let k = 0; k < segs; k++) {
    const y0 = 0.5 + (k * H) / segs;
    const y1 = 0.5 + ((k + 1) * H) / segs;
    const w0 = 1.7 - (k / segs) * 1.3;
    const w1 = 1.7 - ((k + 1) / segs) * 1.3;
    const colr = k % 2 === 0 ? 0xc23a2a : 0xf0ede6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const dx = (w1 - w0) * sx;
      const dz = (w1 - w0) * sz;
      const len = Math.hypot(y1 - y0, dx, dz);
      gb.box('trim', sx * (w0 + w1) / 2, (y0 + y1) / 2, sz * (w0 + w1) / 2, 0.09, len, 0.09, colr, { rz: -Math.atan2(dx, y1 - y0), rx: Math.atan2(dz, y1 - y0) });
    }
    for (const sg of [-1, 1]) {
      gb.box('trim', 0, y1, sg * w1, w1 * 2, 0.05, 0.05, colr);
      gb.box('trim', sg * w1, y1, 0, 0.05, 0.05, w1 * 2, colr);
      const diag = Math.hypot(w0 + w1, y1 - y0);
      gb.box('trim', 0, (y0 + y1) / 2, sg * (w0 + w1) / 2, diag, 0.04, 0.04, colr, { rz: sg * Math.atan2(y1 - y0, w0 + w1) });
      gb.box('trim', sg * (w0 + w1) / 2, (y0 + y1) / 2, 0, 0.04, 0.04, diag, colr, { rx: -sg * Math.atan2(y1 - y0, w0 + w1) });
    }
  }
  gb.cyl('trim', 0, H + 2.5, 0, 0.03, 0.05, 4, 0x2d3236, 6);
  gb.sphere('emissive', 0, H + 4.6, 0, 0.14, 0xff4030);
  gb.cyl('trim', 0.6, H * 0.7, 0, 0.5, 0.5, 0.2, 0xe8e8e8, 12, { rz: Math.PI / 2 });
  gb.cyl('trim', -0.5, H * 0.82, 0.2, 0.4, 0.4, 0.18, 0xe8e8e8, 12, { rz: Math.PI / 2 });
  ccyl(c, 0, 0, 1.6, 0, H, SURF_METAL);
  // equipment hut
  gb.box('metal', 4.2, 1.5, 0, 2.6, 2.4, 3.0, 0x7f8a8f, { uv: 0.5 });
  gb.box('trim', 4.2, 2.74, 0, 2.8, 0.08, 3.2, 0x3a4046);
  cbox(c, 4.2, 0, 2.6, 3.0, 0, 2.8, SURF_METAL);
  lootAt(c, 2.0, 0.53, 2.6, false, 2);
  lootAt(c, -2.6, 0.03, -2.6, false, 2);
  lootAt(c, 4.4, 0.03, 2.6, false, 2);
  end(c);
}

export const BUILDING_DIMS: Record<string, [number, number]> = {
  house: [8.4, 6.6],
  house2: [9.2, 7.4],
  shack: [4.4, 3.8],
  shop: [10.5, 7.2],
  warehouse: [19, 12],
  bunker: [7.4, 6.2],
};
export const BUILDERS: Record<string, (c: Ctx, x: number, y: number, z: number, yaw: number) => void> = {
  house, house2, shack, shop, warehouse, bunker,
};
