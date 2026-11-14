import * as THREE from 'three';
import { CROUCH_HEIGHT, GRAVITY, JUMP_SPEED, PLAYER_RADIUS, STAND_HEIGHT, STEP_HEIGHT, SWIM_DEPTH, WORLD_HALF } from '../config';
import { clamp, damp } from '../core/math';
import type { Game } from '../Game';
import { AMMO_MAX, ARMOR, HEAL, SCOPES, WEAPONS, canMountScope, weaponZoom, type AmmoType, type Item, type WeaponDef } from '../items/defs';
import type { MoveResult } from '../world/Colliders';
import { CharacterModel, defaultAnim, type AnimInput } from './CharacterModel';

export interface WeaponState {
  def: WeaponDef;
  ammo: number;
  /** mounted optic (magnification class), 0 = none */
  scope: number;
}

export type Mode = 'plane' | 'freefall' | 'chute' | 'ground' | 'dead';
export type HealKind = 'bandage' | 'medkit' | 'drink';
export type BodyPart = 'head' | 'body' | 'limb';

const _res: MoveResult = { ground: 0, ceil: false, pushed: false };
const _n = new THREE.Vector3();

/** State and rules shared by the human player and every bot. */
export class Character {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  mode: Mode = 'plane';
  alive = true;
  hp = 100;
  boost = 0;
  helmet = 0;
  helmetDur = 0;
  vest = 0;
  vestDur = 0;
  /** 0,1 = primaries, 2 = sidearm */
  weapons: (WeaponState | null)[] = [null, null, null];
  active = -1;
  ammo: Record<AmmoType, number> = { '9mm': 0, '5.56': 0, '7.62': 0, '12g': 0 };
  grenades = 0;
  bandages = 0;
  medkits = 0;
  drinks = 0;
  crouch = false;
  sprint = false;
  ads = false;
  grounded = false;
  swimming = false;
  fireCd = 0;
  reloadT = -1;
  reloadDur = 1;
  bloom = 0;
  heal: { kind: HealKind; t: number; dur: number } | null = null;
  throwT = -1;
  private thrown = false;
  punchT = -1;
  kills = 0;
  damageDealt = 0;
  headshots = 0;
  longestKill = 0;
  lastHitBy: Character | null = null;
  lastHitT = -99;
  deadT = 0;
  placement = 0;
  /** seconds since this character last fired (for bot hearing / minimap pings) */
  sinceShot = 99;
  model: CharacterModel;
  anim: AnimInput = defaultAnim();
  speed = 0;
  private stepAcc = 0;
  private fallSpeed = 0;
  onHardFloor = false;
  inBuilding = -1;
  /** set by the game each frame: is the model close enough to animate */
  lod = 0;

  constructor(public game: Game, public id: number, public name: string, public isPlayer: boolean, variant: number) {
    this.model = new CharacterModel(variant);
    this.model.group.visible = false;
  }

  get height(): number {
    return this.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  }
  get weapon(): WeaponState | null {
    return this.active >= 0 ? this.weapons[this.active] : null;
  }
  eyeHeight(): number {
    if (this.swimming) return 1.5;
    return this.crouch ? 1.12 : 1.62;
  }
  /** forward unit vector on the ground plane */
  fx(): number {
    return Math.sin(this.yaw);
  }
  fz(): number {
    return Math.cos(this.yaw);
  }
  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  reset(): void {
    this.vel.set(0, 0, 0);
    this.mode = 'plane';
    this.alive = true;
    this.hp = 100;
    this.boost = 0;
    this.helmet = this.vest = 0;
    this.helmetDur = this.vestDur = 0;
    this.weapons = [null, null, null];
    this.active = -1;
    this.ammo = { '9mm': 0, '5.56': 0, '7.62': 0, '12g': 0 };
    this.grenades = this.bandages = this.medkits = this.drinks = 0;
    this.crouch = this.sprint = this.ads = false;
    this.grounded = false;
    this.swimming = false;
    this.fireCd = 0;
    this.reloadT = -1;
    this.bloom = 0;
    this.heal = null;
    this.throwT = -1;
    this.punchT = -1;
    this.kills = this.damageDealt = this.headshots = this.longestKill = 0;
    this.lastHitBy = null;
    this.lastHitT = -99;
    this.deadT = 0;
    this.placement = 0;
    this.sinceShot = 99;
    this.pitch = 0;
    this.anim = defaultAnim();
    this.model.setGear(0, 0);
    this.model.setWeapons(null, null);
    this.model.group.visible = false;
  }

  // ----------------------------------------------------------- movement

  /**
   * Walk / run on the ground. `wx,wz` is the desired world direction
   * (normalised or zero) and `speed` the target speed.
   */
  move(dt: number, wx: number, wz: number, speed: number, jump: boolean): void {
    const world = this.game.world;
    const accel = this.grounded ? 14 : 2.2;
    const k = damp(accel, dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;
    if (this.grounded && jump && !this.swimming) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    const wasGrounded = this.grounded;
    const prevY = this.pos.y;
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
    this.pos.y += this.vel.y * dt;
    const th = world.terrain.heightAt(this.pos.x, this.pos.z);
    const res = world.colliders.resolve(this.pos, PLAYER_RADIUS, this.height, STEP_HEIGHT, th, _res);
    let ground = res.ground;
    this.onHardFloor = ground > th + 0.05;
    this.swimming = false;
    if (!this.onHardFloor && th < -SWIM_DEPTH) {
      // deep water: float with the head above the surface
      ground = -SWIM_DEPTH;
      this.swimming = true;
    } else if (!this.onHardFloor && this.grounded) {
      // slide off slopes that are too steep to stand on
      world.terrain.normalAt(this.pos.x, this.pos.z, _n);
      if (_n.y < 0.62) {
        const s = (0.62 - _n.y) * 26 * dt;
        this.pos.x += _n.x * s;
        this.pos.z += _n.z * s;
        this.vel.x += _n.x * s * 6;
        this.vel.z += _n.z * s * 6;
      }
    }
    if (res.ceil && this.vel.y > 0) this.vel.y = 0;
    if (this.vel.y < this.fallSpeed) this.fallSpeed = this.vel.y;
    const snap = wasGrounded && this.vel.y <= 0 && this.pos.y - ground < STEP_HEIGHT + 0.05;
    if (this.pos.y <= ground + 0.001 || snap) {
      if (!wasGrounded && this.fallSpeed < -11 && !this.swimming && this.mode === 'ground') {
        const dmg = (-this.fallSpeed - 11) * 7;
        this.takeDamage(dmg, null, 'limb', '낙하', 0);
        if (this.isPlayer) this.game.audio.ui('land');
      }
      // climbing a step happens over a few frames rather than instantly
      if (ground > prevY + 0.02 && wasGrounded) this.pos.y = Math.min(ground, Math.max(this.pos.y, prevY) + 7 * dt);
      else this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
      this.fallSpeed = 0;
    } else {
      this.grounded = false;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // footsteps
    if (this.grounded && this.speed > 1.2 && !this.swimming) {
      this.stepAcc += this.speed * dt;
      const stride = this.crouch ? 1.1 : 1.9;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        if (!this.crouch || this.isPlayer) this.game.audio.footstep(this.pos.x, this.pos.y, this.pos.z, this.isPlayer, this.onHardFloor);
      }
    }
  }

  /** Sky-dive / parachute integration. Returns true on touchdown. */
  airStep(dt: number, wx: number, wz: number, hs: number, vs: number): boolean {
    const world = this.game.world;
    const k = damp(2.6, dt);
    this.vel.x += (wx * hs - this.vel.x) * k;
    this.vel.z += (wz * hs - this.vel.z) * k;
    this.vel.y += (-vs - this.vel.y) * damp(2.2, dt);
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
    this.pos.y += this.vel.y * dt;
    const th = world.terrain.heightAt(this.pos.x, this.pos.z);
    const res = world.colliders.resolve(this.pos, PLAYER_RADIUS, STAND_HEIGHT, 0.3, th, _res);
    const ground = Math.max(res.ground, -SWIM_DEPTH);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.pos.y <= ground + 0.03) {
      this.pos.y = ground;
      this.vel.set(0, 0, 0);
      this.mode = 'ground';
      this.grounded = true;
      this.fallSpeed = 0;
      return true;
    }
    return false;
  }

  moveSpeed(): number {
    let s = 4.9;
    if (this.swimming) s = 2.3;
    else if (this.crouch) s = 2.5;
    else if (this.ads) s = 3.0;
    else if (this.sprint) s = 6.6;
    const w = this.weapon;
    if (w && !this.swimming) {
      if (w.def.kind === 'sniper' || w.def.kind === 'dmr') s *= 0.93;
      else if (w.def.kind === 'pistol') s *= 1.03;
    } else if (!this.swimming) s *= 1.05;
    if (this.heal) s *= 0.55;
    if (this.boost > 50) s *= 1.05;
    return s;
  }

  // -------------------------------------------------------------- combat

  canFire(): boolean {
    const w = this.weapon;
    return !!w && this.fireCd <= 0 && this.reloadT < 0 && !this.heal && this.throwT < 0 && w.ammo > 0 && !this.swimming && this.mode === 'ground';
  }

  /** current cone half angle in radians */
  spreadAngle(): number {
    const w = this.weapon;
    if (!w) return 0;
    const base = this.ads ? w.def.adsSpread : w.def.spread;
    let mul = 1 + clamp(this.speed / 6, 0, 1) * (this.ads ? 0.9 : 0.75);
    if (!this.grounded) mul += 1.6;
    if (this.crouch) mul *= 0.78;
    return ((base * mul + this.bloom) * Math.PI) / 180;
  }

  startReload(): boolean {
    const w = this.weapon;
    if (!w || this.reloadT >= 0 || w.ammo >= w.def.mag || this.ammo[w.def.ammo] <= 0 || this.heal || this.throwT >= 0) return false;
    this.reloadT = w.def.reload;
    this.reloadDur = w.def.reload;
    if (this.isPlayer) this.game.audio.ui('reload');
    return true;
  }

  switchTo(slot: number): void {
    if (slot === this.active) return;
    if (slot >= 0 && !this.weapons[slot]) return;
    this.active = slot;
    this.reloadT = -1;
    this.fireCd = Math.max(this.fireCd, 0.32);
    this.bloom = 0;
    this.syncModel();
    if (this.isPlayer) this.game.audio.ui('equip');
  }

  startHeal(kind: HealKind): boolean {
    if (this.heal || this.mode !== 'ground' || this.swimming || this.throwT >= 0) return false;
    if (kind === 'bandage' && (this.bandages <= 0 || this.hp >= HEAL.bandage.cap)) return false;
    if (kind === 'medkit' && (this.medkits <= 0 || this.hp >= 100)) return false;
    if (kind === 'drink' && (this.drinks <= 0 || this.boost >= 95)) return false;
    this.heal = { kind, t: 0, dur: HEAL[kind].time };
    this.reloadT = -1;
    return true;
  }
  cancelHeal(): void {
    this.heal = null;
  }

  startThrow(): boolean {
    if (this.grenades <= 0 || this.throwT >= 0 || this.heal || this.mode !== 'ground' || this.swimming) return false;
    this.throwT = 0;
    this.thrown = false;
    this.reloadT = -1;
    if (this.isPlayer) this.game.audio.ui('pin');
    return true;
  }

  takeDamage(amount: number, from: Character | null, part: BodyPart, weapon: string, dist: number): number {
    if (!this.alive || amount <= 0) return 0;
    if (part === 'head' && this.helmet > 0) {
      const absorbed = amount * ARMOR[this.helmet].reduce;
      amount -= absorbed;
      this.helmetDur -= absorbed * 1.3;
      if (this.helmetDur <= 0) {
        this.helmet = 0;
        this.helmetDur = 0;
        this.syncModel();
      }
    } else if (part === 'body' && this.vest > 0) {
      const absorbed = amount * ARMOR[this.vest].reduce;
      amount -= absorbed;
      this.vestDur -= absorbed * 1.1;
      if (this.vestDur <= 0) {
        this.vest = 0;
        this.vestDur = 0;
        this.syncModel();
      }
    }
    amount = Math.min(amount, this.hp);
    this.hp -= amount;
    if (from && from !== this) {
      from.damageDealt += amount;
      this.lastHitBy = from;
      this.lastHitT = this.game.time;
    }
    if (this.heal) this.heal = null;
    this.game.onDamage(this, from, amount, part);
    if (this.hp <= 0.01) {
      this.hp = 0;
      this.game.onKill(this, from ?? (this.game.time - this.lastHitT < 12 ? this.lastHitBy : null), weapon, part === 'head', dist);
    }
    return amount;
  }

  // ----------------------------------------------------------- inventory

  hasFreeSlotFor(def: WeaponDef): boolean {
    if (def.kind === 'pistol') return !this.weapons[2];
    return !this.weapons[0] || !this.weapons[1];
  }

  /**
   * Take an item. Returns anything that had to be dropped in exchange, or
   * null when the item was refused (nothing changes in that case).
   */
  take(item: Item): Item[] | null {
    const dropped: Item[] = [];
    switch (item.kind) {
      case 'weapon': {
        const def = WEAPONS[item.sub!];
        let slot: number;
        if (def.kind === 'pistol') slot = 2;
        else if (!this.weapons[0]) slot = 0;
        else if (!this.weapons[1]) slot = 1;
        else slot = this.active === 0 || this.active === 1 ? this.active : 0;
        const old = this.weapons[slot];
        let scope = 0;
        if (old) {
          dropped.push({ kind: 'weapon', sub: old.def.id, n: old.ammo });
          // the optic stays with you when it fits the new gun
          if (old.scope > 0) {
            if (canMountScope(def)) scope = old.scope;
            else dropped.push({ kind: 'scope', n: old.scope });
          }
        }
        this.weapons[slot] = { def, ammo: item.n, scope };
        if (this.active < 0 || this.active === slot || (def.kind !== 'pistol' && this.active === 2)) {
          this.active = slot;
          this.reloadT = -1;
          this.fireCd = Math.max(this.fireCd, 0.3);
        }
        break;
      }
      case 'ammo': {
        const t = item.sub as AmmoType;
        const room = AMMO_MAX[t] - this.ammo[t];
        if (room <= 0) return null;
        const n = Math.min(room, item.n);
        this.ammo[t] += n;
        if (n < item.n) dropped.push({ kind: 'ammo', sub: t, n: item.n - n });
        break;
      }
      case 'helmet': {
        const dur = item.dur ?? ARMOR[item.n].dur;
        if (item.n < this.helmet || (item.n === this.helmet && dur <= this.helmetDur)) return null;
        if (this.helmet > 0) dropped.push({ kind: 'helmet', n: this.helmet, dur: this.helmetDur });
        this.helmet = item.n;
        this.helmetDur = dur;
        break;
      }
      case 'vest': {
        const dur = item.dur ?? ARMOR[item.n].dur;
        if (item.n < this.vest || (item.n === this.vest && dur <= this.vestDur)) return null;
        if (this.vest > 0) dropped.push({ kind: 'vest', n: this.vest, dur: this.vestDur });
        this.vest = item.n;
        this.vestDur = dur;
        break;
      }
      case 'bandage':
        if (this.bandages >= HEAL.bandage.max) return null;
        this.bandages = Math.min(HEAL.bandage.max, this.bandages + item.n);
        break;
      case 'medkit':
        if (this.medkits >= HEAL.medkit.max) return null;
        this.medkits += 1;
        break;
      case 'drink':
        if (this.drinks >= HEAL.drink.max) return null;
        this.drinks += 1;
        break;
      case 'grenade':
        if (this.grenades >= 4) return null;
        this.grenades += 1;
        break;
      case 'scope': {
        const slot = this.scopeTarget(item.n);
        if (slot < 0) return null;
        const w = this.weapons[slot]!;
        if (w.scope > 0) dropped.push({ kind: 'scope', n: w.scope });
        w.scope = item.n;
        break;
      }
    }
    this.syncModel();
    return dropped;
  }

  /** primary slot an optic of this class would improve (active weapon first), or -1 */
  scopeTarget(mag: number): number {
    const order = this.active === 1 ? [1, 0] : [0, 1];
    for (const s of order) {
      const w = this.weapons[s];
      if (!w || !canMountScope(w.def) || mag <= w.scope) continue;
      // never trade a gun's built-in optic for a weaker one
      if (w.scope === 0 && SCOPES[mag].zoom <= w.def.zoom) continue;
      return s;
    }
    return -1;
  }

  /** current ADS magnification */
  zoom(): number {
    const w = this.weapon;
    return w ? weaponZoom(w.def, w.scope) : 1;
  }

  /** would `take` accept this item and is it an upgrade worth walking to? */
  wants(item: Item): number {
    switch (item.kind) {
      case 'weapon': {
        const def = WEAPONS[item.sub!];
        if (def.kind === 'pistol') return this.weapons[2] ? 0 : this.weapons[0] || this.weapons[1] ? 1.5 : 6;
        if (!this.weapons[0] && !this.weapons[1]) return 10;
        if (!this.weapons[0] || !this.weapons[1]) {
          const have = (this.weapons[0] ?? this.weapons[1])!.def;
          return have.id === def.id ? 1 : 5;
        }
        return 0;
      }
      case 'ammo': {
        const t = item.sub as AmmoType;
        const uses = this.weapons.some((w) => w && w.def.ammo === t);
        if (!uses) return 0;
        const have = this.ammo[t];
        return have >= AMMO_MAX[t] ? 0 : have < 60 ? 5 : 1.5;
      }
      case 'scope':
        return this.scopeTarget(item.n) >= 0 ? 1.5 + item.n * 0.25 : 0;
      case 'helmet':
        return item.n > this.helmet ? 3 + item.n : 0;
      case 'vest':
        return item.n > this.vest ? 4 + item.n : 0;
      case 'bandage':
        return this.bandages < 5 ? 2.5 : this.bandages < HEAL.bandage.max ? 0.5 : 0;
      case 'medkit':
        return this.medkits < 2 ? 3.5 : this.medkits < HEAL.medkit.max ? 1 : 0;
      case 'drink':
        return this.drinks < 3 ? 1.5 : 0;
      case 'grenade':
        return this.grenades < 2 ? 1.5 : 0;
    }
  }

  /** everything this character carries, used to build the death loot pile */
  spill(): Item[] {
    const out: Item[] = [];
    for (const w of this.weapons) {
      if (!w) continue;
      out.push({ kind: 'weapon', sub: w.def.id, n: w.ammo });
      if (w.scope > 0) out.push({ kind: 'scope', n: w.scope });
    }
    for (const t of Object.keys(this.ammo) as AmmoType[]) {
      let n = this.ammo[t];
      while (n > 0) {
        const k = Math.min(n, 60);
        out.push({ kind: 'ammo', sub: t, n: k });
        n -= k;
      }
    }
    if (this.helmet > 0) out.push({ kind: 'helmet', n: this.helmet, dur: this.helmetDur });
    if (this.vest > 0) out.push({ kind: 'vest', n: this.vest, dur: this.vestDur });
    if (this.bandages > 0) out.push({ kind: 'bandage', n: this.bandages });
    for (let i = 0; i < this.medkits; i++) out.push({ kind: 'medkit', n: 1 });
    for (let i = 0; i < this.drinks; i++) out.push({ kind: 'drink', n: 1 });
    for (let i = 0; i < this.grenades; i++) out.push({ kind: 'grenade', n: 1 });
    return out;
  }

  syncModel(): void {
    this.model.setGear(this.helmet, this.vest);
    const act = this.weapon;
    let back: string | null = null;
    for (let i = 0; i < 2; i++) {
      const w = this.weapons[i];
      if (w && i !== this.active) back = w.def.id;
    }
    this.model.setWeapons(act ? act.def.id : null, back, act ? act.scope : 0);
  }

  // ------------------------------------------------------------- per frame

  /** timers that run regardless of who is in control */
  tick(dt: number): void {
    this.sinceShot += dt;
    if (!this.alive) {
      this.deadT += dt;
      return;
    }
    if (this.fireCd > 0) this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * (this.ads ? 7 : 5));
    const w = this.weapon;
    if (this.reloadT >= 0 && w) {
      this.reloadT -= dt;
      if (this.reloadT < 0) {
        const need = w.def.mag - w.ammo;
        const n = Math.min(need, this.ammo[w.def.ammo]);
        w.ammo += n;
        this.ammo[w.def.ammo] -= n;
        this.reloadT = -1;
        if (this.isPlayer) this.game.audio.ui('reloadDone');
      }
    }
    if (this.heal) {
      this.heal.t += dt;
      if (this.heal.t >= this.heal.dur) {
        const kind = this.heal.kind;
        if (kind === 'bandage') {
          this.bandages--;
          this.hp = Math.min(HEAL.bandage.cap, this.hp + HEAL.bandage.amount);
        } else if (kind === 'medkit') {
          this.medkits--;
          this.hp = 100;
        } else {
          this.drinks--;
          this.boost = Math.min(100, this.boost + 45);
        }
        this.heal = null;
        if (this.isPlayer) this.game.audio.ui('heal');
      }
    }
    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - dt * 0.75);
      if (this.hp < 100) this.hp = Math.min(100, this.hp + dt * (this.boost > 50 ? 1.6 : 0.9));
    }
    if (this.throwT >= 0) {
      this.throwT += dt / 0.75;
      if (!this.thrown && this.throwT >= 0.62) {
        this.thrown = true;
        this.grenades--;
        this.game.combat.throwGrenade(this);
      }
      if (this.throwT >= 1) this.throwT = -1;
    }
    if (this.punchT >= 0) {
      this.punchT += dt / 0.4;
      if (this.punchT >= 1) this.punchT = -1;
    }
  }

  /** push simulation state into the visual model */
  present(dt: number): void {
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    if (this.lod > 1) return;
    const a = this.anim;
    a.mode = this.mode === 'dead' ? 'dead' : this.mode === 'freefall' ? 'freefall' : this.mode === 'chute' ? 'chute' : this.swimming ? 'swim' : 'ground';
    a.speed = this.speed;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    // world velocity -> character space (x = left, z = forward)
    a.moveX = this.vel.x * c - this.vel.z * s;
    a.moveZ = this.vel.x * s + this.vel.z * c;
    a.crouch = this.crouch;
    a.sprint = this.sprint;
    a.grounded = this.grounded;
    a.pitch = this.pitch;
    a.weapon = this.weapon ? this.weapon.def.id : null;
    a.ads = this.ads;
    a.reload = this.reloadT >= 0 ? 1 - this.reloadT / this.reloadDur : -1;
    a.heal = this.heal ? this.heal.t / this.heal.dur : -1;
    a.healKind = this.heal ? this.heal.kind : '';
    a.throwing = this.throwT;
    a.punch = this.punchT;
    a.deadT = this.deadT;
    this.model.update(dt, a);
  }
}
