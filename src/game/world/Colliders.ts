import { WORLD_HALF, WORLD_SIZE } from '../config';

export const SURF_DIRT = 0;
export const SURF_WOOD = 1;
export const SURF_CONCRETE = 2;
export const SURF_METAL = 3;
export const SURF_ROCK = 4;
export const SURF_WATER = 5;
export const SURF_FLESH = 6;

export interface Collider {
  /** 0 = oriented box, 1 = vertical cylinder */
  type: 0 | 1;
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  y0: number;
  /** top (for ramps: top at local -x end) */
  y1: number;
  /** top at local +x end (== y1 when not a ramp) */
  y1b: number;
  surf: number;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  surf: number;
}

const CELL = 8;
const GRID = Math.ceil(WORLD_SIZE / CELL);

export interface MoveResult {
  ground: number;
  ceil: boolean;
  pushed: boolean;
}

export class ColliderWorld {
  list: Collider[] = [];
  private cells: (number[] | undefined)[] = new Array(GRID * GRID);
  private stamp = new Uint32Array(0);
  private stampId = 1;
  private scratch: number[] = [];

  addBox(x: number, z: number, hx: number, hz: number, yaw: number, y0: number, y1: number, surf: number, y1b?: number): number {
    const c: Collider = { type: 0, x, z, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), y0, y1, y1b: y1b ?? y1, surf };
    const ex = Math.abs(hx * c.cos) + Math.abs(hz * c.sin);
    const ez = Math.abs(hx * c.sin) + Math.abs(hz * c.cos);
    return this.insert(c, x - ex, z - ez, x + ex, z + ez);
  }
  addCyl(x: number, z: number, r: number, y0: number, y1: number, surf: number): number {
    const c: Collider = { type: 1, x, z, hx: r, hz: r, cos: 1, sin: 0, y0, y1, y1b: y1, surf };
    return this.insert(c, x - r, z - r, x + r, z + r);
  }
  private insert(c: Collider, x0: number, z0: number, x1: number, z1: number): number {
    const id = this.list.length;
    this.list.push(c);
    const i0 = Math.max(0, Math.floor((x0 + WORLD_HALF) / CELL));
    const i1 = Math.min(GRID - 1, Math.floor((x1 + WORLD_HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z0 + WORLD_HALF) / CELL));
    const j1 = Math.min(GRID - 1, Math.floor((z1 + WORLD_HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * GRID + i;
        (this.cells[k] ??= []).push(id);
      }
    }
    return id;
  }
  /** call once after all colliders are registered */
  finalize(): void {
    this.stamp = new Uint32Array(this.list.length + 1);
  }
  private nextStamp(): number {
    if (this.stamp.length < this.list.length + 1) this.stamp = new Uint32Array(this.list.length + 64);
    this.stampId++;
    if (this.stampId > 4e9) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  private gather(x: number, z: number, r: number): number[] {
    const out = this.scratch;
    out.length = 0;
    const s = this.nextStamp();
    const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / CELL));
    const i1 = Math.min(GRID - 1, Math.floor((x + r + WORLD_HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / CELL));
    const j1 = Math.min(GRID - 1, Math.floor((z + r + WORLD_HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.cells[j * GRID + i];
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          if (this.stamp[id] !== s) {
            this.stamp[id] = s;
            out.push(id);
          }
        }
      }
    }
    return out;
  }

  private topAt(c: Collider, lx: number): number {
    if (c.y1b === c.y1) return c.y1;
    const t = Math.min(1, Math.max(0, (lx + c.hx) / (2 * c.hx)));
    return c.y1 + (c.y1b - c.y1) * t;
  }

  /**
   * Push a vertical capsule (feet at p.y) out of solid geometry and report the
   * walkable surface underneath it. `p` is modified in place.
   */
  resolve(p: { x: number; y: number; z: number }, radius: number, height: number, step: number, terrainH: number, out: MoveResult): MoveResult {
    out.ground = terrainH;
    out.ceil = false;
    out.pushed = false;
    const ids = this.gather(p.x, p.z, radius + 0.6);
    for (let iter = 0; iter < 2; iter++) {
      for (let n = 0; n < ids.length; n++) {
        const c = this.list[ids[n]];
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        if (c.type === 1) {
          if (p.y + step >= c.y1 || p.y + height <= c.y0) continue;
          const d = Math.hypot(dx, dz);
          const rr = radius + c.hx;
          if (d < rr) {
            if (d > 1e-4) {
              p.x += (dx / d) * (rr - d);
              p.z += (dz / d) * (rr - d);
            } else p.x += rr;
            out.pushed = true;
          }
          continue;
        }
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const qx = Math.min(c.hx, Math.max(-c.hx, lx));
        const qz = Math.min(c.hz, Math.max(-c.hz, lz));
        const top = this.topAt(c, qx);
        if (p.y + step >= top || p.y + height <= c.y0) continue;
        let ox = lx - qx;
        let oz = lz - qz;
        const d = Math.hypot(ox, oz);
        if (d >= radius) continue;
        if (c.y0 > p.y + height * 0.62 && d < radius * 0.6) {
          // only our head pokes into it from below: treat as a ceiling
          p.y = c.y0 - height;
          out.ceil = true;
          continue;
        }
        let push: number;
        if (d > 1e-4) {
          push = radius - d;
          ox /= d;
          oz /= d;
        } else {
          // centre is inside: leave through the nearest face
          const px = c.hx - Math.abs(lx);
          const pz = c.hz - Math.abs(lz);
          if (px < pz) {
            ox = lx >= 0 ? 1 : -1;
            oz = 0;
            push = px + radius;
          } else {
            ox = 0;
            oz = lz >= 0 ? 1 : -1;
            push = pz + radius;
          }
        }
        p.x += (ox * c.cos + oz * c.sin) * push;
        p.z += (-ox * c.sin + oz * c.cos) * push;
        out.pushed = true;
      }
    }
    // walkable surface below
    for (let n = 0; n < ids.length; n++) {
      const c = this.list[ids[n]];
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      if (c.type === 1) {
        if (c.y1 > p.y + step || c.y1 <= out.ground) continue;
        if (dx * dx + dz * dz <= c.hx * c.hx) out.ground = c.y1;
        continue;
      }
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      const pad = 0.12;
      if (Math.abs(lx) > c.hx + pad || Math.abs(lz) > c.hz + pad) continue;
      const top = this.topAt(c, lx);
      if (top <= p.y + step && top > out.ground) out.ground = top;
    }
    return out;
  }

  /** Would a character standing at (x,y,z) intersect something solid? */
  blocked(x: number, y: number, z: number, radius: number, height: number, step: number): boolean {
    const ids = this.gather(x, z, radius + 0.2);
    for (let n = 0; n < ids.length; n++) {
      const c = this.list[ids[n]];
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.type === 1) {
        if (y + step >= c.y1 || y + height <= c.y0) continue;
        const rr = radius + c.hx;
        if (dx * dx + dz * dz < rr * rr) return true;
        continue;
      }
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      const qx = Math.min(c.hx, Math.max(-c.hx, lx));
      const qz = Math.min(c.hz, Math.max(-c.hz, lz));
      const top = this.topAt(c, qx);
      if (y + step >= top || y + height <= c.y0) continue;
      const ox = lx - qx;
      const oz = lz - qz;
      if (ox * ox + oz * oz < radius * radius) return true;
    }
    return false;
  }

  /** Highest walkable collider top under (x,z) that is not above `maxY`. */
  surfaceBelow(x: number, z: number, maxY: number, base: number): number {
    let best = base;
    const ids = this.gather(x, z, 0.3);
    for (let n = 0; n < ids.length; n++) {
      const c = this.list[ids[n]];
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.type === 1) {
        if (c.y1 <= maxY && c.y1 > best && dx * dx + dz * dz <= c.hx * c.hx) best = c.y1;
        continue;
      }
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
      const top = this.topAt(c, lx);
      if (top <= maxY && top > best) best = top;
    }
    return best;
  }

  /** Ray against all static colliders. Returns true and fills `hit` on impact. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, hit: RayHit): boolean {
    let best = maxDist;
    let found = false;
    const s = this.nextStamp();
    let cx = Math.floor((ox + WORLD_HALF) / CELL);
    let cz = Math.floor((oz + WORLD_HALF) / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const tDeltaX = adx > 1e-8 ? CELL / adx : Infinity;
    const tDeltaZ = adz > 1e-8 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-8 ? ((cx + (dx > 0 ? 1 : 0)) * CELL - WORLD_HALF - ox) / dx : Infinity;
    let tMaxZ = adz > 1e-8 ? ((cz + (dz > 0 ? 1 : 0)) * CELL - WORLD_HALF - oz) / dz : Infinity;
    let guard = 0;
    while (guard++ < 600) {
      if (cx >= 0 && cz >= 0 && cx < GRID && cz < GRID) {
        const cell = this.cells[cz * GRID + cx];
        if (cell) {
          for (let k = 0; k < cell.length; k++) {
            const id = cell[k];
            if (this.stamp[id] === s) continue;
            this.stamp[id] = s;
            const t = this.rayCollider(this.list[id], ox, oy, oz, dx, dy, dz, best, hit);
            if (t >= 0 && t < best) {
              best = t;
              found = true;
            }
          }
        }
      } else if (guard > 2 && ((cx < 0 && stepX < 0) || (cx >= GRID && stepX > 0) || (cz < 0 && stepZ < 0) || (cz >= GRID && stepZ > 0))) {
        break;
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > best) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    if (found) hit.t = best;
    return found;
  }

  private rayCollider(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, hit: RayHit): number {
    const top = Math.max(c.y1, c.y1b);
    if (c.type === 1) {
      const px = ox - c.x;
      const pz = oz - c.z;
      const a = dx * dx + dz * dz;
      const r = c.hx;
      let tSide = -1;
      if (a > 1e-9) {
        const b = px * dx + pz * dz;
        const cc = px * px + pz * pz - r * r;
        const disc = b * b - a * cc;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / a;
          if (t >= 0 && t < maxT) {
            const y = oy + dy * t;
            if (y >= c.y0 && y <= top) tSide = t;
          }
        }
      }
      // top cap
      if (dy < -1e-6 && oy > top) {
        const t = (top - oy) / dy;
        if (t >= 0 && t < maxT && (tSide < 0 || t < tSide)) {
          const hx = px + dx * t;
          const hz = pz + dz * t;
          if (hx * hx + hz * hz <= r * r) {
            hit.nx = 0;
            hit.ny = 1;
            hit.nz = 0;
            hit.surf = c.surf;
            return t;
          }
        }
      }
      if (tSide >= 0) {
        hit.nx = (px + dx * tSide) / r;
        hit.ny = 0;
        hit.nz = (pz + dz * tSide) / r;
        hit.surf = c.surf;
        return tSide;
      }
      return -1;
    }
    const rx = ox - c.x;
    const rz = oz - c.z;
    const lox = rx * c.cos - rz * c.sin;
    const loz = rx * c.sin + rz * c.cos;
    const ldx = dx * c.cos - dz * c.sin;
    const ldz = dx * c.sin + dz * c.cos;
    let tmin = 0;
    let tmax = maxT;
    let axis = -1;
    let sign = 0;
    // X slab
    if (Math.abs(ldx) < 1e-9) {
      if (lox < -c.hx || lox > c.hx) return -1;
    } else {
      let t1 = (-c.hx - lox) / ldx;
      let t2 = (c.hx - lox) / ldx;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 0;
        sign = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) {
      if (oy < c.y0 || oy > top) return -1;
    } else {
      let t1 = (c.y0 - oy) / dy;
      let t2 = (top - oy) / dy;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 1;
        sign = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Z slab
    if (Math.abs(ldz) < 1e-9) {
      if (loz < -c.hz || loz > c.hz) return -1;
    } else {
      let t1 = (-c.hz - loz) / ldz;
      let t2 = (c.hz - loz) / ldz;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 2;
        sign = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (axis < 0) return -1; // origin inside the box: ignore so muzzles in walls don't self-hit
    if (c.y1 !== c.y1b) {
      // ramps: reject hits above the sloped surface
      const lx = lox + ldx * tmin;
      const y = oy + dy * tmin;
      if (y > this.topAt(c, lx) + 0.05) return -1;
    }
    if (axis === 0) {
      hit.nx = sign * c.cos;
      hit.ny = 0;
      hit.nz = -sign * c.sin;
    } else if (axis === 1) {
      hit.nx = 0;
      hit.ny = sign;
      hit.nz = 0;
    } else {
      hit.nx = sign * c.sin;
      hit.ny = 0;
      hit.nz = sign * c.cos;
    }
    hit.surf = c.surf;
    return tmin;
  }
}
