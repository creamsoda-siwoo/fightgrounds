import * as THREE from 'three';
import { GRAVITY } from '../config';
import { lerp } from '../core/math';
import type { BodyPart, Character } from '../entities/Character';
import { getModels } from '../entities/Models';
import type { Game } from '../Game';
import { SURF_FLESH } from '../world/Colliders';
import type { WorldHit } from '../world/World';

interface Grenade {
  mesh: THREE.Mesh;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  owner: Character;
  spin: number;
}

const _hit: WorldHit = { t: 0, nx: 0, ny: 1, nz: 0, surf: 0, x: 0, y: 0, z: 0 };
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

function rayCapsuleY(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, y0: number, y1: number, r: number): number {
  let best = -1;
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  const t2 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
  if (t2 >= 0 && (best < 0 || t2 < best)) best = t2;
  return best;
}

export interface CharHit {
  c: Character | null;
  part: BodyPart;
  t: number;
}

export class Combat {
  group = new THREE.Group();
  private grenades: Grenade[] = [];
  private charHit: CharHit = { c: null, part: 'body', t: 0 };

  constructor(private game: Game) {}

  /** nearest character struck by the ray, ignoring `skip` */
  rayChars(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, skip: Character | null): CharHit {
    const out = this.charHit;
    out.c = null;
    out.t = max;
    const chars = this.game.chars;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (!c.alive || c === skip || c.mode === 'plane') continue;
      const cx = c.pos.x - ox;
      const cy = c.pos.y + 0.9 - oy;
      const cz = c.pos.z - oz;
      const tca = cx * dx + cy * dy + cz * dz;
      if (tca < -1.5 || tca > out.t + 1.5) continue;
      const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
      if (d2 > 2.6) continue;
      if (c.mode !== 'ground') {
        const t = raySphere(ox, oy, oz, dx, dy, dz, c.pos.x, c.pos.y + 0.9, c.pos.z, 0.55);
        if (t >= 0 && t < out.t) {
          out.t = t;
          out.c = c;
          out.part = 'body';
        }
        continue;
      }
      const h = c.swimming ? 1.62 : c.height;
      const px = -Math.cos(c.yaw) * c.peek * 0.32;
      const pz = Math.sin(c.yaw) * c.peek * 0.32;
      const th = raySphere(ox, oy, oz, dx, dy, dz, c.pos.x + c.fx() * 0.04 + px, c.pos.y + h - 0.12 - Math.abs(c.peek) * 0.06, c.pos.z + c.fz() * 0.04 + pz, 0.128);
      if (th >= 0 && th < out.t) {
        out.t = th;
        out.c = c;
        out.part = 'head';
      }
      const tb = rayCapsuleY(ox, oy, oz, dx, dy, dz, c.pos.x, c.pos.z, c.pos.y + h * 0.53, c.pos.y + h - 0.37, 0.205);
      if (tb >= 0 && tb < out.t) {
        out.t = tb;
        out.c = c;
        out.part = 'body';
      }
      const tl = rayCapsuleY(ox, oy, oz, dx, dy, dz, c.pos.x, c.pos.z, c.pos.y + 0.14, c.pos.y + h * 0.53, 0.165);
      if (tl >= 0 && tl < out.t) {
        out.t = tl;
        out.c = c;
        out.part = 'limb';
      }
    }
    return out;
  }

  /** One trigger pull. `dir` must be normalised; spread is applied here. */
  fire(shooter: Character, ox: number, oy: number, oz: number, dir: THREE.Vector3): void {
    const w = shooter.weapon;
    if (!w) return;
    const game = this.game;
    const def = w.def;
    const spread = shooter.spreadAngle();
    w.ammo--;
    shooter.fireCd = 60 / def.rpm;
    shooter.sinceShot = 0;
    shooter.bloom = Math.min(def.spread * 2.2, shooter.bloom + def.recoil * (shooter.ads ? 0.22 : 0.4));
    shooter.anim.kick = Math.min(1.2, 0.35 + def.recoil * 0.3);

    const cam = game.camera.position;
    const camDist = Math.hypot(shooter.pos.x - cam.x, shooter.pos.y - cam.y, shooter.pos.z - cam.z);
    // visual muzzle position
    if (shooter.lod <= 1) shooter.model.muzzleWorld(_m);
    else _m.set(ox + dir.x * 0.6, oy - 0.15, oz + dir.z * 0.6);

    // basis perpendicular to the aim direction
    _u.crossVectors(dir, Math.abs(dir.y) > 0.95 ? RIGHT : UP).normalize();
    _v.crossVectors(dir, _u);

    const player = game.player;
    for (let p = 0; p < def.pellets; p++) {
      const ang = spread * Math.sqrt(Math.random());
      const phi = Math.random() * Math.PI * 2;
      const k = Math.tan(ang);
      _d.copy(dir).addScaledVector(_u, Math.cos(phi) * k).addScaledVector(_v, Math.sin(phi) * k).normalize();
      let max = 900;
      const worldHit = game.world.raycast(ox, oy, oz, _d.x, _d.y, _d.z, max, _hit);
      if (worldHit) max = _hit.t;
      const ch = this.rayChars(ox, oy, oz, _d.x, _d.y, _d.z, max, shooter);
      let ex: number;
      let ey: number;
      let ez: number;
      if (ch.c) {
        const t = ch.t;
        ex = ox + _d.x * t;
        ey = oy + _d.y * t;
        ez = oz + _d.z * t;
        const fall = t <= def.falloffStart ? 1 : t >= def.falloffEnd ? def.minDamage : lerp(1, def.minDamage, (t - def.falloffStart) / (def.falloffEnd - def.falloffStart));
        const mul = ch.part === 'head' ? def.headMul : ch.part === 'limb' ? 0.78 : 1;
        const victim = ch.c;
        const part = ch.part;
        const wasAlive = victim.alive;
        victim.takeDamage(def.damage * fall * mul, shooter, part, def.name, t);
        if (camDist < 260 || victim === player) {
          game.effects.impact(ex, ey, ez, -_d.x, 0.2, -_d.z, SURF_FLESH);
          game.audio.impact(SURF_FLESH, ex, ey, ez);
        }
        if (shooter === player) game.onPlayerHit(part === 'head', wasAlive && !victim.alive);
      } else if (worldHit) {
        ex = _hit.x;
        ey = _hit.y;
        ez = _hit.z;
        const dc = Math.hypot(ex - cam.x, ey - cam.y, ez - cam.z);
        if (dc < 170) {
          game.effects.impact(ex, ey, ez, _hit.nx, _hit.ny, _hit.nz, _hit.surf);
          if (p === 0) game.audio.impact(_hit.surf, ex, ey, ez);
        }
      } else {
        ex = ox + _d.x * 700;
        ey = oy + _d.y * 700;
        ez = oz + _d.z * 700;
      }
      if ((p % 3 === 0) && (camDist < 500 || Math.hypot(ex - cam.x, ez - cam.z) < 300)) game.effects.tracer(_m.x, _m.y, _m.z, ex, ey, ez);
      // supersonic crack past the player's ear
      if (p === 0 && shooter !== player && player.alive) {
        const px = player.pos.x - ox;
        const py = player.pos.y + 1.5 - oy;
        const pz = player.pos.z - oz;
        const tc = px * _d.x + py * _d.y + pz * _d.z;
        if (tc > 2 && tc < max + 1) {
          const cx = px - _d.x * tc;
          const cy = py - _d.y * tc;
          const cz = pz - _d.z * tc;
          const miss = Math.hypot(cx, cy, cz);
          if (miss < 2.4 && miss > 0.35) game.onNearMiss(-cx, -cz);
        }
      }
    }
    if (camDist < 320) game.effects.muzzle(_m.x, _m.y, _m.z, dir.x, dir.y, dir.z, def.kind === 'shotgun' || def.kind === 'sniper', camDist < 45);
    game.audio.shot(def.kind, shooter.pos.x, shooter.pos.y + 1.4, shooter.pos.z, shooter === player);
    game.noise(shooter.pos.x, shooter.pos.z, def.loudness, shooter);
  }

  melee(attacker: Character): void {
    if (attacker.fireCd > 0 || attacker.punchT >= 0) return;
    attacker.punchT = 0;
    attacker.fireCd = 0.5;
    const game = this.game;
    let best: Character | null = null;
    let bd = 2.0;
    for (const c of game.chars) {
      if (!c.alive || c === attacker || c.mode !== 'ground') continue;
      const dx = c.pos.x - attacker.pos.x;
      const dz = c.pos.z - attacker.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(c.pos.y - attacker.pos.y) > 1.5) continue;
      if ((dx * attacker.fx() + dz * attacker.fz()) / Math.max(0.01, d) < 0.45) continue;
      bd = d;
      best = c;
    }
    if (best) {
      const wasAlive = best.alive;
      best.takeDamage(19, attacker, 'body', '주먹', bd);
      game.effects.impact(best.pos.x, best.pos.y + 1.3, best.pos.z, -attacker.fx(), 0.3, -attacker.fz(), SURF_FLESH);
      game.audio.impact(SURF_FLESH, best.pos.x, best.pos.y + 1.3, best.pos.z);
      if (attacker === game.player) game.onPlayerHit(false, wasAlive && !best.alive);
    }
  }

  throwGrenade(c: Character): void {
    const lib = getModels();
    const mesh = new THREE.Mesh(lib.grenade, lib.gearMat);
    mesh.castShadow = true;
    mesh.scale.setScalar(1.25);
    this.group.add(mesh);
    c.aimDir(_d);
    const speed = 17;
    const g: Grenade = {
      mesh,
      x: c.pos.x + c.fx() * 0.4 - Math.cos(c.yaw) * 0.25,
      y: c.pos.y + c.eyeHeight() + 0.1,
      z: c.pos.z + c.fz() * 0.4 + Math.sin(c.yaw) * 0.25,
      vx: _d.x * speed + c.vel.x * 0.6,
      vy: _d.y * speed + 4.2,
      vz: _d.z * speed + c.vel.z * 0.6,
      fuse: 2.7,
      owner: c,
      spin: Math.random() * 6,
    };
    this.grenades.push(g);
    if (c === this.game.player) this.game.audio.ui('throw');
  }

  explode(x: number, y: number, z: number, owner: Character | null): void {
    const game = this.game;
    game.effects.explosion(x, y, z);
    game.audio.explosion(x, y, z);
    game.noise(x, z, 420, owner);
    const R = 9.5;
    for (const c of game.chars) {
      if (!c.alive || c.mode === 'plane') continue;
      const cy = c.pos.y + c.height * 0.55;
      const d = Math.hypot(c.pos.x - x, cy - y, c.pos.z - z);
      if (d > R) continue;
      if (d > 1.2 && !game.world.clearLine(x, y + 0.6, z, c.pos.x, cy, c.pos.z)) continue;
      const dmg = d < 2.4 ? 130 : 130 * Math.pow(1 - (d - 2.4) / (R - 2.4), 1.4);
      const wasAlive = c.alive;
      c.takeDamage(dmg, owner, 'body', '수류탄', d);
      if (owner === game.player && c !== owner) game.onPlayerHit(false, wasAlive && !c.alive);
    }
    game.shake(x, y, z, 1);
  }

  update(dt: number): void {
    const game = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.group.remove(g.mesh);
        this.grenades.splice(i, 1);
        this.explode(g.x, g.y + 0.1, g.z, g.owner);
        continue;
      }
      g.vy -= GRAVITY * dt;
      const sp = Math.hypot(g.vx, g.vy, g.vz);
      const step = sp * dt;
      if (step > 1e-4) {
        const dx = g.vx / sp;
        const dy = g.vy / sp;
        const dz = g.vz / sp;
        if (game.world.raycast(g.x, g.y, g.z, dx, dy, dz, step + 0.08, _hit, false)) {
          const t = Math.max(0, _hit.t - 0.08);
          g.x += dx * t;
          g.y += dy * t;
          g.z += dz * t;
          const vn = g.vx * _hit.nx + g.vy * _hit.ny + g.vz * _hit.nz;
          g.vx = (g.vx - 1.38 * vn * _hit.nx) * 0.72;
          g.vy = (g.vy - 1.38 * vn * _hit.ny) * 0.72;
          g.vz = (g.vz - 1.38 * vn * _hit.nz) * 0.72;
          if (sp > 3) game.audio.impact(2, g.x, g.y, g.z);
        } else {
          g.x += g.vx * dt;
          g.y += g.vy * dt;
          g.z += g.vz * dt;
        }
      }
      const floor = Math.max(game.world.heightAt(g.x, g.z), -0.4);
      if (g.y < floor + 0.06) {
        g.y = floor + 0.06;
        if (g.vy < 0) g.vy = -g.vy * 0.3;
        g.vx *= 0.8;
        g.vz *= 0.8;
      }
      g.spin += dt * Math.min(12, sp * 1.5);
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.set(g.spin, g.spin * 0.7, 0);
    }
  }

  clear(): void {
    for (const g of this.grenades) this.group.remove(g.mesh);
    this.grenades.length = 0;
  }
}
