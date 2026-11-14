import * as THREE from 'three';
import { DIFFICULTY, PLAYER_RADIUS, STEP_HEIGHT, SWIM_DEPTH } from '../config';
import { angleDiff, clamp, damp, gauss, rint, rrange, wrapAngle, type Rng } from '../core/math';
import type { Game } from '../Game';
import type { LootItem } from '../items/Loot';
import type { Character } from './Character';

type State = 'loot' | 'roam' | 'rotate' | 'combat' | 'flee' | 'heal' | 'hunt';

interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** how close counts as reached */
  r: number;
}

const _d = new THREE.Vector3();
const _list: LootItem[] = [];

/**
 * A computer controlled survivor. Bots drop from the aircraft, loot towns,
 * rotate with the storm and fight with the same weapons, recoil-free hitscan
 * and line-of-sight rules as the player; their aim is degraded by a skill
 * dependent tracking error instead of perfect knowledge.
 */
export class Bot {
  state: State = 'loot';
  skill: number;
  private baseSkill: number;
  private react = 1;
  aggression: number;
  private rng: Rng;
  private thinkT = 0;
  private percT = 0;
  target: Character | null = null;
  private visible = false;
  private seenFor = 0;
  private lostT = 99;
  private lastSeen = new THREE.Vector3();
  private notice: Float32Array;
  private path: Waypoint[] = [];
  private goalItem: LootItem | null = null;
  private blacklist = new Set<number>();
  private stuckT = 0;
  private stuckN = 0;
  private lastX = 0;
  private lastZ = 0;
  private detourT = 0;
  private detourX = 0;
  private detourZ = 0;
  private avoidSide = 1;
  private avoidT = 0;
  private errYaw = 0;
  private errPitch = 0;
  private burst = 0;
  private pause = 0;
  private strafe = 1;
  private strafeT = 0;
  private crouchT = 0;
  private alertT = 0;
  private alert = new THREE.Vector3();
  private fleeT = 0;
  private roamT = 0;
  private zoneGoal = new THREE.Vector3();
  private zoneGoalPhase = -1;
  private healWait = 0;
  private jumpCd = 0;
  /** flight progress (0..1) at which this bot leaves the aircraft */
  jumpAt = 0.5;
  dropX = 0;
  dropZ = 0;
  private wantYaw = 0;
  private nadeCd = 0;
  private lootScanT = 0;

  constructor(private game: Game, public c: Character, rng: Rng) {
    this.rng = rng;
    this.baseSkill = clamp(0.28 + rng() * 0.62 + (rng() < 0.12 ? 0.12 : 0), 0.25, 0.97);
    this.skill = this.baseSkill;
    this.aggression = clamp(0.2 + rng() * 0.8, 0, 1);
    this.notice = new Float32Array(64);
    this.thinkT = rng() * 0.3;
    this.percT = rng() * 0.2;
  }

  reset(): void {
    const diff = DIFFICULTY[this.game.difficulty];
    this.skill = clamp(this.baseSkill * diff.mul + diff.add, 0.15, 0.98);
    this.react = diff.react;
    this.state = 'loot';
    this.target = null;
    this.visible = false;
    this.seenFor = 0;
    this.lostT = 99;
    this.notice.fill(0);
    this.path.length = 0;
    this.goalItem = null;
    this.blacklist.clear();
    this.stuckT = 0;
    this.stuckN = 0;
    this.detourT = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.burst = 0;
    this.pause = 0;
    this.alertT = 0;
    this.fleeT = 0;
    this.roamT = 0;
    this.zoneGoalPhase = -1;
    this.healWait = 0;
    this.nadeCd = 6;
  }

  /** called by the game when this bot is struck */
  onHit(from: Character | null): void {
    if (!from || !from.alive || from === this.c) return;
    if (from.id < this.notice.length) this.notice[from.id] = 1.2;
    const c = this.c;
    const dNew = from.pos.distanceTo(c.pos);
    if (!this.target || !this.visible || dNew < this.target.pos.distanceTo(c.pos) * 0.8) {
      this.target = from;
      // the shooter's exact position is only known roughly
      const err = Math.min(12, dNew * 0.08) * (1.2 - this.skill);
      this.lastSeen.set(from.pos.x + gauss(this.rng) * err, from.pos.y, from.pos.z + gauss(this.rng) * err);
      this.lostT = 0;
    }
    this.thinkT = 0;
  }

  /** a gunshot or explosion was heard */
  onNoise(x: number, z: number, loud: number, src: Character | null): void {
    const c = this.c;
    if (src === c || !c.alive || c.mode !== 'ground') return;
    const d = Math.hypot(x - c.pos.x, z - c.pos.z);
    if (d > loud) return;
    if (this.target && this.visible) return;
    if (this.alertT > 0 && Math.hypot(this.alert.x - c.pos.x, this.alert.z - c.pos.z) < d) return;
    const err = d * 0.12 * (1.3 - this.skill);
    this.alert.set(x + gauss(this.rng) * err, 0, z + gauss(this.rng) * err);
    this.alertT = 5 + this.aggression * 6;
  }

  update(dt: number): void {
    const c = this.c;
    const game = this.game;
    if (!c.alive) return;
    if (c.mode === 'plane') {
      if (game.plane.canJump && game.plane.progress >= this.jumpAt) game.jumpFromPlane(c);
      return;
    }
    if (c.mode === 'freefall' || c.mode === 'chute') {
      this.dropStep(dt);
      return;
    }
    this.percT -= dt;
    if (this.percT <= 0) {
      const step = 0.16 + this.rng() * 0.08;
      this.perceive(step);
      this.percT = step;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.28 + this.rng() * 0.14;
      this.think();
    }
    this.alertT -= dt;
    this.pause -= dt;
    this.nadeCd -= dt;
    this.jumpCd -= dt;
    this.avoidT -= dt;
    this.detourT -= dt;
    this.act(dt);
  }

  // -------------------------------------------------------------- drop

  private dropStep(dt: number): void {
    const c = this.c;
    const game = this.game;
    let dx = this.dropX - c.pos.x;
    let dz = this.dropZ - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) {
      dx /= d;
      dz /= d;
    }
    c.yaw += angleDiff(c.yaw, Math.atan2(dx, dz)) * damp(3, dt);
    if (c.mode === 'freefall') {
      c.airStep(dt, dx, dz, d > 40 ? 26 : 6, 46);
      const ground = Math.max(0, game.world.heightAt(c.pos.x, c.pos.z));
      if ((c.mode as string) === 'freefall' && c.pos.y - ground < 90 + (c.id % 7) * 3) c.mode = 'chute';
    } else {
      const near = d < 5;
      if (c.airStep(dt, near ? 0 : Math.sin(c.yaw), near ? 0 : Math.cos(c.yaw), near ? 0 : d > 60 ? 15 : 9, d > 80 ? 5.2 : 7.5)) {
        game.onLanded(c);
        this.state = 'loot';
        this.thinkT = this.rng() * 0.3;
      }
    }
  }

  // --------------------------------------------------------- perception

  private perceive(step: number): void {
    const c = this.c;
    const game = this.game;
    const chars = game.chars;
    const ex = c.pos.x;
    const ey = c.pos.y + c.eyeHeight();
    const ez = c.pos.z;
    const fx = c.fx();
    const fz = c.fz();
    c.inBuilding = game.world.buildingAt(c.pos.x, c.pos.z, c.pos.y);
    let best: Character | null = null;
    let bestScore = 0;
    let targetVisible = false;
    for (let i = 0; i < chars.length; i++) {
      const o = chars[i];
      if (o === c) continue;
      const n = this.notice[o.id];
      if (!o.alive || o.mode === 'plane') {
        this.notice[o.id] = 0;
        continue;
      }
      const dx = o.pos.x - ex;
      const dz = o.pos.z - ez;
      const d = Math.hypot(dx, dz);
      let range = 175 + this.skill * 40;
      if (o.crouch) range *= 0.72;
      if (o.speed < 0.4) range *= 0.82;
      if (o.sinceShot < 1.2) range *= 1.5;
      if (o.mode !== 'ground') range *= 1.2;
      let seen = false;
      if (d < range) {
        const dot = d > 0.5 ? (dx * fx + dz * fz) / d : 1;
        const inView = dot > 0.36 || d < 7 || (d < 22 && o.speed > 3 && !o.crouch) || o === this.target;
        if (inView) {
          const oy = o.pos.y + (o.mode === 'ground' ? o.height * 0.72 : 0.9);
          seen = game.world.clearLine(ex, ey, ez, o.pos.x, oy, o.pos.z) || (d < 90 && game.world.clearLine(ex, ey, ez, o.pos.x, o.pos.y + o.height - 0.12, o.pos.z));
        }
      }
      if (seen) {
        // far, still, crouched targets take longer to register
        const rate = (2.4 + this.skill * 3.2) / (1 + d / 38) * (o.sinceShot < 1 ? 2.5 : 1);
        this.notice[o.id] = Math.min(1.5, n + step * rate);
      } else if (n > 0) {
        this.notice[o.id] = Math.max(0, n - step * 0.3);
      }
      if (seen && this.notice[o.id] >= 1) {
        let score = 60 / (8 + d);
        if (o === this.target) score *= 1.6;
        if (c.lastHitBy === o && game.time - c.lastHitT < 4) score *= 2;
        if (o.mode !== 'ground') score *= 0.35;
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
        if (o === this.target) targetVisible = true;
      }
    }
    if (best) {
      if (best !== this.target) {
        this.seenFor = 0;
        // fresh target: aim starts off-centre and settles
        this.errYaw += gauss(this.rng) * 0.09 * (1.3 - this.skill);
        this.errPitch += gauss(this.rng) * 0.05 * (1.3 - this.skill);
      }
      this.target = best;
      this.visible = true;
      this.lostT = 0;
      this.lastSeen.copy(best.pos);
      this.seenFor += step;
    } else {
      this.visible = false;
      this.lostT += step;
      if (this.target && (!this.target.alive || this.lostT > 7 + this.aggression * 5)) this.target = null;
    }
    void targetVisible;
  }

  // ------------------------------------------------------------ decide

  private armed(): boolean {
    const c = this.c;
    for (const w of c.weapons) if (w && (w.ammo > 0 || c.ammo[w.def.ammo] > 0)) return true;
    return false;
  }

  /** pick the carried weapon that suits the engagement distance */
  private chooseWeapon(d: number): void {
    const c = this.c;
    let best = -1;
    let bs = Infinity;
    for (let s = 0; s < 3; s++) {
      const w = c.weapons[s];
      if (!w || (w.ammo <= 0 && c.ammo[w.def.ammo] <= 0)) continue;
      let score = Math.abs(Math.log(Math.max(2, d) / w.def.botRange));
      if (w.ammo <= 0) score += d < 15 ? 1.2 : 0.3;
      if (w.def.kind === 'pistol') score += 0.5;
      if (s === c.active) score -= 0.25;
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    if (best >= 0 && best !== c.active && c.reloadT < 0) c.switchTo(best);
    else if (best < 0 && c.active >= 0) c.switchTo(-1);
  }

  private think(): void {
    const c = this.c;
    const game = this.game;
    const zone = game.zone;
    const armed = this.armed();
    const t = this.target;
    const outside = !zone.inside(c.pos.x, c.pos.z, 3);
    const dn = Math.hypot(c.pos.x - zone.nx, c.pos.z - zone.nz);
    const toSafe = Math.max(0, dn - zone.nr * 0.85);
    const eta = toSafe / 5.2;
    const timeLeft = zone.state === 'waiting' ? zone.timer + (dn - zone.nr > 0 ? 8 : 0) : zone.state === 'shrinking' ? zone.timer * 0.5 : 0;
    const mustMove = zone.state !== 'idle' && (outside || (toSafe > 0 && eta > timeLeft - 12));

    if (t && this.visible) {
      const d = t.pos.distanceTo(c.pos);
      if (armed) {
        this.chooseWeapon(d);
        // keep running for safety if the storm is the bigger threat
        if (outside && d > 45 && c.hp < 70) return this.setState('rotate');
        if (c.hp < 30 && (c.medkits > 0 || c.bandages > 0) && d > 12 && this.rng() < 0.6) {
          this.fleeT = 4;
          return this.setState('flee');
        }
        return this.setState('combat');
      }
      // unarmed: only run from people who can actually shoot back
      const threat = t.weapons.some((w) => w !== null);
      if (threat && d < 60) {
        if (this.state !== 'flee') this.fleeT = 3.5;
        return this.setState('flee');
      }
      if (!threat && d < 5 && this.aggression > 0.6 && t.mode === 'ground') return this.setState('combat');
    }
    if (this.state === 'flee' && this.fleeT > 0 && t && this.lostT < 2) return;
    const calm = game.time - c.lastHitT > 2.2;
    if (c.hp < 55 && (c.medkits > 0 || c.bandages > 0) && calm && !(outside && zone.dps() > 2)) return this.setState('heal');
    if (c.heal) return;
    if (mustMove) return this.setState('rotate');
    if (t && armed && this.lostT < 6 && this.aggression > 0.35) {
      this.chooseWeapon(t.pos.distanceTo(c.pos));
      return this.setState('hunt');
    }
    if (this.alertT > 0 && armed && this.aggression > 0.45 && Math.hypot(this.alert.x - c.pos.x, this.alert.z - c.pos.z) < 140) {
      this.lastSeen.set(this.alert.x, game.world.heightAt(this.alert.x, this.alert.z), this.alert.z);
      return this.setState('hunt');
    }
    // top up between fights
    if (calm) {
      if (c.hp < 76 && c.bandages > 0) return this.setState('heal');
      if (c.boost < 20 && c.drinks > 0 && c.hp < 100) return this.setState('heal');
    }
    const w = c.weapon;
    if (w && w.ammo < w.def.mag * 0.45 && c.reloadT < 0) c.startReload();
    if (this.goalItem && this.goalItem.alive && this.path.length) return this.setState('loot');
    if (this.pickLoot()) return this.setState('loot');
    this.setState('roam');
  }

  private setState(s: State): void {
    if (s === this.state) return;
    if (this.state === 'loot' && this.goalItem) {
      if (this.goalItem.claim === this.c.id) this.goalItem.claim = -1;
      this.goalItem = null;
    }
    this.state = s;
    this.path.length = 0;
    this.stuckN = 0;
    if (s !== 'heal') this.c.cancelHeal();
  }

  private kitted(): boolean {
    const c = this.c;
    const prim = c.weapons[0] ?? c.weapons[1];
    return !!prim && c.ammo[prim.def.ammo] + prim.ammo > 70 && c.vest > 0 && c.helmet > 0;
  }

  private pickLoot(): boolean {
    const c = this.c;
    const game = this.game;
    const radius = this.kitted() ? 18 : 60;
    const list = game.loot.query(c.pos.x, c.pos.z, radius, _list);
    let best: LootItem | null = null;
    let bs = 0;
    for (const li of list) {
      if (!li.alive || this.blacklist.has(li.id)) continue;
      if (li.claim >= 0 && li.claim !== c.id && game.time - li.claimT < 12) continue;
      if (!game.zone.inside(li.x, li.z, 2)) continue;
      const want = c.wants(li.item);
      if (want <= 0) continue;
      const d = Math.hypot(li.x - c.pos.x, li.z - c.pos.z) + Math.abs(li.y - c.pos.y) * 3;
      const score = want / (7 + d);
      if (score > bs) {
        bs = score;
        best = li;
      }
    }
    if (!best) return false;
    this.goalItem = best;
    best.claim = c.id;
    best.claimT = game.time;
    this.planTo(best.x, best.y, best.z, best.building, best.upstairs, 0.9);
    return true;
  }

  /** build a waypoint list that respects doors and stairs */
  private planTo(x: number, y: number, z: number, destB: number, upstairs: boolean, reach: number): void {
    const c = this.c;
    const world = this.game.world;
    const bs = world.buildings;
    const path = this.path;
    path.length = 0;
    const curB = c.inBuilding;
    const nearestDoor = (b: number, px: number, pz: number) => {
      const doors = bs[b].doors;
      let best = doors[0];
      let bd = Infinity;
      for (const d of doors) {
        const dd = Math.hypot(d.ox - px, d.oz - pz);
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      return best;
    };
    let fromX = c.pos.x;
    let fromZ = c.pos.z;
    if (curB >= 0 && curB !== destB) {
      const B = bs[curB];
      if (B.stair && c.pos.y > B.y + 2) {
        path.push({ x: B.stair.tx, y: B.stair.topY, z: B.stair.tz, r: 0.5 });
        path.push({ x: B.stair.bx, y: B.y + 0.2, z: B.stair.bz, r: 0.6 });
      }
      const door = nearestDoor(curB, x, z);
      path.push({ x: door.ix, y: B.y + 0.2, z: door.iz, r: 0.55 });
      path.push({ x: door.ox, y: B.y, z: door.oz, r: 0.7 });
      fromX = door.ox;
      fromZ = door.oz;
    }
    if (destB >= 0) {
      const B = bs[destB];
      if (curB !== destB) {
        const door = nearestDoor(destB, fromX, fromZ);
        path.push({ x: door.ox, y: B.y, z: door.oz, r: 0.7 });
        path.push({ x: door.ix, y: B.y + 0.2, z: door.iz, r: 0.55 });
      }
      if (B.stair) {
        const amUp = curB === destB && c.pos.y > B.y + 2;
        if (upstairs && !amUp) {
          path.push({ x: B.stair.bx, y: B.y + 0.2, z: B.stair.bz, r: 0.45 });
          path.push({ x: B.stair.tx, y: B.stair.topY, z: B.stair.tz, r: 0.6 });
        } else if (!upstairs && amUp) {
          path.push({ x: B.stair.tx, y: B.stair.topY, z: B.stair.tz, r: 0.5 });
          path.push({ x: B.stair.bx, y: B.y + 0.2, z: B.stair.bz, r: 0.6 });
        }
      }
    }
    path.push({ x, y, z, r: reach });
  }

  // ---------------------------------------------------------------- act

  private act(dt: number): void {
    const c = this.c;
    const game = this.game;
    let mx = 0;
    let mz = 0;
    let sprint = false;
    let walk = false;
    let faceMove = true;
    c.ads = false;

    switch (this.state) {
      case 'combat': {
        const t = this.target;
        if (!t || !t.alive) {
          this.state = 'roam';
          break;
        }
        faceMove = false;
        const dx = t.pos.x - c.pos.x;
        const dz = t.pos.z - c.pos.z;
        const d = Math.hypot(dx, dz) || 0.01;
        const w = c.weapon;
        const pr = w ? w.def.botRange : 3;
        this.aimAt(dt, t, d);
        // footwork
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = rrange(this.rng, 0.6, 1.9);
          this.strafe = this.rng() < 0.5 ? 1 : -1;
          if (this.rng() < 0.2) this.strafe = 0;
          this.crouchT = d > 26 && this.rng() < 0.3 + this.skill * 0.3 ? rrange(this.rng, 0.8, 2) : 0;
        }
        this.crouchT -= dt;
        const nx = dx / d;
        const nz = dz / d;
        let adv = 0;
        if (d > pr * 1.5) adv = 1;
        else if (d < pr * 0.4 && d < 30) adv = -0.8;
        if (!this.visible) adv = this.lostT > 0.8 && this.aggression > 0.4 ? 1 : 0;
        if (c.reloadT >= 0 && d < 20) adv = -0.6;
        mx = nx * adv + -nz * this.strafe * 0.85;
        mz = nz * adv + nx * this.strafe * 0.85;
        c.crouch = this.crouchT > 0 && adv === 0;
        c.ads = d > 22 && !!w && this.visible;
        walk = c.ads;
        sprint = adv > 0 && d > pr * 2.6 && !this.visible;
        this.fireControl(dt, t, d);
        // lob a grenade at someone hiding
        if (!this.visible && this.lostT > 1.2 && this.lostT < 5 && c.grenades > 0 && this.nadeCd <= 0 && d > 9 && d < 34 && this.rng() < 0.02) {
          this.nadeCd = 12;
          c.pitch = clamp(0.18 + d * 0.012, 0.1, 0.7);
          c.startThrow();
        }
        break;
      }
      case 'hunt': {
        const d = Math.hypot(this.lastSeen.x - c.pos.x, this.lastSeen.z - c.pos.z);
        if (d < 5) {
          // nothing here: look around, then give up
          this.alertT = 0;
          this.target = this.visible ? this.target : null;
          this.wantYaw += dt * 1.6;
          faceMove = false;
          c.yaw += angleDiff(c.yaw, this.wantYaw) * damp(4, dt);
          this.thinkT = Math.min(this.thinkT, 0.15);
          if (!this.target) this.state = 'roam';
        } else {
          if (!this.path.length) this.planTo(this.lastSeen.x, this.lastSeen.y, this.lastSeen.z, -1, false, 4);
          sprint = d > 28;
          [mx, mz] = this.follow();
        }
        c.crouch = false;
        break;
      }
      case 'flee': {
        this.fleeT -= dt;
        const t = this.target;
        if (t && this.fleeT > 0) {
          const dx = c.pos.x - t.pos.x;
          const dz = c.pos.z - t.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          // run away at an angle, drifting towards the safe zone
          const zx = game.zone.nx - c.pos.x;
          const zz = game.zone.nz - c.pos.z;
          const zl = Math.hypot(zx, zz) || 1;
          mx = dx / d + (zx / zl) * 0.5 + -dz / d * 0.4 * this.strafe;
          mz = dz / d + (zz / zl) * 0.5 + dx / d * 0.4 * this.strafe;
          sprint = true;
          if (!this.visible && this.lostT > 1.5) this.fleeT = Math.min(this.fleeT, 0.5);
        } else {
          this.state = 'roam';
          this.thinkT = 0;
        }
        c.crouch = false;
        break;
      }
      case 'heal': {
        c.crouch = true;
        this.healWait -= dt;
        if (!c.heal && this.healWait <= 0) {
          let ok = false;
          if (c.hp < 45 && c.medkits > 0) ok = c.startHeal('medkit');
          if (!ok && c.hp < 75 && c.bandages > 0) ok = c.startHeal('bandage');
          if (!ok && c.hp < 100 && c.medkits > 0 && c.hp < 60) ok = c.startHeal('medkit');
          if (!ok && c.drinks > 0 && c.boost < 60) ok = c.startHeal('drink');
          if (!ok) {
            c.crouch = false;
            this.state = 'roam';
            this.thinkT = 0;
          }
          this.healWait = 0.3;
        }
        break;
      }
      case 'rotate': {
        const zone = game.zone;
        if (this.zoneGoalPhase !== zone.phase || !zone.insideNext(this.zoneGoal.x, this.zoneGoal.z, 2)) {
          // head for a spot inside the next circle on our side of it
          this.zoneGoalPhase = zone.phase;
          const dx = c.pos.x - zone.nx;
          const dz = c.pos.z - zone.nz;
          const base = Math.atan2(dz, dx) + rrange(this.rng, -0.9, 0.9);
          const rad = zone.nr * rrange(this.rng, 0.15, 0.7);
          let gx = zone.nx + Math.cos(base) * rad;
          let gz = zone.nz + Math.sin(base) * rad;
          for (let k = 0; k < 6 && game.world.heightAt(gx, gz) < 0.5; k++) {
            const a = this.rng() * 6.28;
            const r2 = zone.nr * this.rng() * 0.7;
            gx = zone.nx + Math.cos(a) * r2;
            gz = zone.nz + Math.sin(a) * r2;
          }
          this.zoneGoal.set(gx, game.world.heightAt(gx, gz), gz);
          this.path.length = 0;
        }
        if (!this.path.length) this.planTo(this.zoneGoal.x, this.zoneGoal.y, this.zoneGoal.z, -1, false, 5);
        [mx, mz] = this.follow();
        sprint = true;
        c.crouch = false;
        if (!this.path.length) {
          this.state = 'roam';
          this.thinkT = 0;
        }
        break;
      }
      case 'loot': {
        const li = this.goalItem;
        if (!li || !li.alive) {
          this.goalItem = null;
          this.path.length = 0;
          this.thinkT = 0;
          break;
        }
        const d = Math.hypot(li.x - c.pos.x, li.z - c.pos.z);
        if (d < 1.25 && Math.abs(li.y - c.pos.y) < 1.4) {
          this.grab(li);
          this.goalItem = null;
          this.path.length = 0;
          this.thinkT = 0.05 + this.rng() * 0.25;
          break;
        }
        if (!this.path.length) this.planTo(li.x, li.y, li.z, li.building, li.upstairs, 0.9);
        [mx, mz] = this.follow();
        sprint = d > 14 && c.inBuilding < 0;
        c.crouch = false;
        break;
      }
      default: {
        // roam: wander between points of interest inside the safe area
        this.roamT -= dt;
        if (!this.path.length || this.roamT <= 0) {
          this.roamT = rrange(this.rng, 14, 30);
          const zone = game.zone;
          let gx = 0;
          let gz = 0;
          let found = false;
          for (let k = 0; k < 8 && !found; k++) {
            if (this.rng() < 0.6) {
              const s = game.world.sites[rint(this.rng, 0, game.world.sites.length - 1)];
              const a = this.rng() * 6.28;
              gx = s.x + Math.cos(a) * s.radius * this.rng() * 0.8;
              gz = s.z + Math.sin(a) * s.radius * this.rng() * 0.8;
            } else {
              const a = this.rng() * 6.28;
              const r = 30 + this.rng() * 110;
              gx = c.pos.x + Math.cos(a) * r;
              gz = c.pos.z + Math.sin(a) * r;
            }
            const inNext = zone.state === 'idle' || zone.insideNext(gx, gz, 6);
            found = inNext && game.world.heightAt(gx, gz) > 0.6 && Math.hypot(gx - c.pos.x, gz - c.pos.z) < 260;
          }
          if (!found) {
            const a = this.rng() * 6.28;
            gx = zone.nx + Math.cos(a) * zone.nr * 0.5;
            gz = zone.nz + Math.sin(a) * zone.nr * 0.5;
          }
          this.planTo(gx, game.world.heightAt(gx, gz), gz, -1, false, 4);
        }
        [mx, mz] = this.follow();
        walk = this.kitted() && this.aggression < 0.5;
        c.crouch = false;
        // look for pickups on the way
        this.lootScanT -= dt;
        if (this.lootScanT <= 0) {
          this.lootScanT = 0.6;
          this.opportunistic();
        }
      }
    }

    // -------------------------------------------------- locomotion
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      mx /= ml;
      mz /= ml;
      [mx, mz] = this.steer(mx, mz);
    }
    const moving = Math.hypot(mx, mz) > 0.01;
    c.sprint = sprint && moving && !c.crouch && !c.ads && !c.heal;
    let speed = moving ? c.moveSpeed() : 0;
    if (walk && !c.sprint) speed = Math.min(speed, 3.2);
    let jump = false;
    // stuck handling: hop, sidestep, eventually give up on the goal
    if (moving) {
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        const moved = Math.hypot(c.pos.x - this.lastX, c.pos.z - this.lastZ);
        this.lastX = c.pos.x;
        this.lastZ = c.pos.z;
        this.stuckT = 0;
        if (moved < 0.5 * (speed / 5)) {
          this.stuckN++;
          if (this.jumpCd <= 0) {
            jump = true;
            this.jumpCd = 1.2;
          }
          const a = this.rng() * Math.PI * 2;
          this.detourX = Math.cos(a);
          this.detourZ = Math.sin(a);
          this.detourT = 0.5 + this.rng() * 0.6;
          if (this.stuckN >= 5) {
            if (this.goalItem) {
              this.blacklist.add(this.goalItem.id);
              if (this.goalItem.claim === c.id) this.goalItem.claim = -1;
              this.goalItem = null;
            }
            this.path.length = 0;
            this.roamT = 0;
            this.stuckN = 0;
            this.thinkT = 0;
          }
        } else if (this.stuckN > 0) this.stuckN--;
      }
      if (this.detourT > 0) {
        mx = this.detourX;
        mz = this.detourZ;
      }
    } else {
      this.stuckT = 0;
    }
    if (faceMove && moving) {
      this.wantYaw = Math.atan2(mx, mz);
      c.yaw = wrapAngle(c.yaw + angleDiff(c.yaw, this.wantYaw) * damp(9, dt));
      c.pitch += (0 - c.pitch) * damp(6, dt);
    }
    c.move(dt, mx, mz, speed, jump);
  }

  private grab(li: LootItem): void {
    const c = this.c;
    const game = this.game;
    if (!li.alive) return;
    const dropped = c.take(li.item);
    if (dropped === null) {
      this.blacklist.add(li.id);
      return;
    }
    game.loot.remove(li);
    if (dropped.length) game.loot.scatter(dropped, c.pos.x + c.fx() * 0.6, c.pos.y, c.pos.z + c.fz() * 0.6, li.building, li.upstairs);
    for (const d of dropped) void d;
    const w = c.weapon;
    if (w && w.ammo < w.def.mag && c.reloadT < 0) c.startReload();
  }

  /** scoop up anything useful that happens to be underfoot */
  private opportunistic(): void {
    const c = this.c;
    const list = this.game.loot.query(c.pos.x, c.pos.z, 1.5, _list);
    for (const li of list) {
      if (li.alive && Math.abs(li.y - c.pos.y) < 1.3 && c.wants(li.item) > 0) {
        this.grab(li);
        return;
      }
    }
  }

  /** direction towards the current waypoint, popping reached ones */
  private follow(): [number, number] {
    const c = this.c;
    const path = this.path;
    while (path.length) {
      const wp = path[0];
      const dx = wp.x - c.pos.x;
      const dz = wp.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < wp.r && Math.abs(wp.y - c.pos.y) < 1.6) {
        path.shift();
        continue;
      }
      return [dx / (d || 1), dz / (d || 1)];
    }
    return [0, 0];
  }

  /** local obstacle avoidance: probe ahead and veer around what is in the way */
  private steer(mx: number, mz: number): [number, number] {
    const c = this.c;
    const world = this.game.world;
    const col = world.colliders;
    const y = c.pos.y;
    const h = c.height;
    const probe = (dx: number, dz: number): boolean => {
      for (const k of [0.9, 1.9]) {
        const px = c.pos.x + dx * k;
        const pz = c.pos.z + dz * k;
        if (col.blocked(px, y, pz, PLAYER_RADIUS * 0.95, h, STEP_HEIGHT)) return true;
      }
      // keep out of deep water unless already swimming
      if (!c.swimming && c.inBuilding < 0 && world.heightAt(c.pos.x + dx * 5, c.pos.z + dz * 5) < -SWIM_DEPTH + 0.2) return true;
      return false;
    };
    if (!probe(mx, mz)) return [mx, mz];
    const angles = [0.6, 1.1, 1.6, 2.2];
    const first = this.avoidT > 0 ? this.avoidSide : this.rng() < 0.5 ? 1 : -1;
    for (const a of angles) {
      for (const side of [first, -first]) {
        const cs = Math.cos(a * side);
        const sn = Math.sin(a * side);
        const dx = mx * cs - mz * sn;
        const dz = mx * sn + mz * cs;
        if (!probe(dx, dz)) {
          this.avoidSide = side;
          this.avoidT = 1.4;
          return [dx, dz];
        }
      }
    }
    return [mx, mz];
  }

  // ------------------------------------------------------------- shooting

  private aimAt(dt: number, t: Character, d: number): void {
    const c = this.c;
    const game = this.game;
    const known = this.visible ? t.pos : this.lastSeen;
    const head = this.skill > 0.6 && d < 45 && (c.id + Math.floor(game.time * 0.5)) % 3 === 0;
    const ty = known.y + (t.mode === 'ground' ? t.height * (head ? 0.93 : 0.7) : 0.9);
    const dx = known.x - c.pos.x;
    const dz = known.z - c.pos.z;
    const dy = ty - (c.pos.y + c.eyeHeight());
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    // tracking error drifts like a hand would: mean reverting noise that
    // grows with target and own movement and shrinks with skill
    const sigma = (1.25 - this.skill) * (0.011 + t.speed * 0.0042 + c.speed * 0.003 + (c.ads ? 0 : 0.006)) * (t.crouch ? 1.15 : 1);
    const theta = 2.2 + this.skill * 3;
    const sq = Math.sqrt(dt);
    this.errYaw += -this.errYaw * theta * dt + gauss(this.rng) * sigma * 2.4 * sq;
    this.errPitch += -this.errPitch * theta * dt + gauss(this.rng) * sigma * 1.5 * sq;
    const turn = (3.2 + this.skill * 5.5) * dt;
    const dyaw = angleDiff(c.yaw, wantYaw + this.errYaw);
    c.yaw = wrapAngle(c.yaw + clamp(dyaw, -turn, turn));
    const dp = wantPitch + this.errPitch - c.pitch;
    c.pitch = clamp(c.pitch + clamp(dp, -turn, turn), -1.3, 1.3);
    this.wantYaw = wantYaw;
  }

  private fireControl(dt: number, t: Character, d: number): void {
    const c = this.c;
    const game = this.game;
    const w = c.weapon;
    if (!w) {
      // fists as a last resort
      if (d < 1.9) game.combat.melee(c);
      return;
    }
    if (w.ammo <= 0) {
      if (c.reloadT < 0 && !c.startReload()) this.chooseWeapon(d);
      return;
    }
    if (!this.visible || c.reloadT >= 0) return;
    const react = (0.22 + (1 - this.skill) * 0.6) * this.react;
    if (this.seenFor < react) return;
    if (d > Math.min(w.def.falloffEnd, w.def.botRange * 4.5)) return;
    // only pull the trigger when the sights are roughly on target
    const off = Math.abs(angleDiff(c.yaw, this.wantYaw));
    const tol = 0.05 + 1.1 / Math.max(4, d);
    if (off > tol) return;
    if (this.burst <= 0) {
      if (this.pause > 0) return;
      if (w.def.auto) this.burst = d < 20 ? rint(this.rng, 5, 12) : d < 60 ? rint(this.rng, 3, 6) : rint(this.rng, 2, 3);
      else this.burst = w.def.kind === 'pistol' ? rint(this.rng, 1, 3) : 1;
    }
    if (!c.canFire()) return;
    c.aimDir(_d);
    const ex = c.pos.x - Math.cos(c.yaw) * 0.14;
    const ey = c.pos.y + c.eyeHeight();
    const ez = c.pos.z + Math.sin(c.yaw) * 0.14;
    game.combat.fire(c, ex, ey, ez, _d);
    // muzzle climb the bot has to fight
    this.errPitch += (w.def.recoil * 0.0035) * (1.3 - this.skill);
    this.errYaw += gauss(this.rng) * w.def.recoil * 0.002 * (1.3 - this.skill);
    this.burst--;
    if (this.burst <= 0) {
      const base = w.def.auto ? rrange(this.rng, 0.22, 0.7) : w.def.kind === 'sniper' ? rrange(this.rng, 0.4, 1.2) : rrange(this.rng, 0.18, 0.55);
      this.pause = base / (0.55 + this.skill * 0.7);
    } else if (!w.def.auto) {
      c.fireCd = Math.max(c.fireCd, rrange(this.rng, 0.16, 0.34) / (0.6 + this.skill * 0.6));
    }
    void dt;
    void t;
  }
}
