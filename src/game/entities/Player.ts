import * as THREE from 'three';
import { angleDiff, clamp, damp, lerp } from '../core/math';
import type { Game } from '../Game';
import { WEAPONS, itemLabel } from '../items/defs';
import type { LootItem } from '../items/Loot';
import type { WorldHit } from '../world/World';
import type { Character } from './Character';

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _piv = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _hit: WorldHit = { t: 0, nx: 0, ny: 1, nz: 0, surf: 0, x: 0, y: 0, z: 0 };

/** Human control: input mapping, third-person camera, looting prompts. */
export class Player {
  yaw = 0;
  pitch = 0;
  private recover = 0;
  private camDist = 3;
  private fov = 66;
  private adsT = 0;
  private shoulder = 0.5;
  shakeAmp = 0;
  private shakeT = 0;
  near: LootItem | null = null;
  private scanT = 0;
  scoped = false;
  /** current crosshair spread in radians, read by the HUD */
  spread = 0;
  private orbit = 0;
  nearList: LootItem[] = [];
  private specPos = new THREE.Vector3();
  private specDir = new THREE.Vector3(0, 0, 1);
  /** keep running forward without holding W (= key / stick lock) */
  autoRun = false;
  /** camera-only yaw offset while holding Alt */
  freeLook = 0;
  private autoT = 0;
  private autoTarget = false;
  private lastShot = -9;

  constructor(private game: Game, public c: Character) {}

  reset(): void {
    this.pitch = -0.25;
    this.recover = 0;
    this.adsT = 0;
    this.shakeAmp = 0;
    this.near = null;
    this.scoped = false;
    this.camDist = 3;
    this.autoRun = false;
    this.freeLook = 0;
  }

  update(dt: number): void {
    const game = this.game;
    const input = game.input;
    const c = this.c;
    const free = game.uiOpen();
    // --- look
    const looking = (input.down('AltLeft') || input.down('AltRight')) && !c.ads && c.alive;
    if (input.locked && !free) {
      const zoom = c.ads && c.weapon ? c.zoom() : 1;
      const sens = (0.0021 * input.sensitivity) / (zoom > 1.6 ? zoom * 0.8 : 1);
      if (looking) this.freeLook = clamp(this.freeLook - input.mouseDX * sens, -2.4, 2.4);
      else this.yaw -= input.mouseDX * sens;
      this.pitch = clamp(this.pitch - input.mouseDY * sens, -1.45, 1.45);
    }
    if (!looking && this.freeLook !== 0) {
      // swing the camera back behind the character
      this.freeLook *= 1 - damp(12, dt);
      if (Math.abs(this.freeLook) < 0.002) this.freeLook = 0;
    }
    if (game.autoPlay && c.alive && c.mode !== 'plane') {
      // the AI is driving: the camera follows where it looks
      this.yaw += angleDiff(this.yaw, c.yaw) * damp(6, dt);
      this.pitch += (clamp(c.pitch * 0.7 - 0.08, -1, 0.8) - this.pitch) * damp(5, dt);
      this.spread = c.spreadAngle();
      return;
    }
    if (game.autoPlay && c.mode === 'plane') return;
    if (this.recover > 0) {
      const r = Math.min(this.recover, dt * (this.recover * 9 + 0.03));
      this.pitch -= r;
      this.recover -= r;
    }
    if (!c.alive) {
      this.orbit += dt * 0.12;
      return;
    }
    if (input.hit('Equal')) this.game.setAutoRun(!this.autoRun);
    // on touch the stick itself presses W, so there the next stick touch cancels instead
    else if (this.autoRun && !input.touch && (input.hit('KeyW') || input.hit('KeyS'))) this.game.setAutoRun(false);
    const fwd = this.autoRun ? 1 : (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const side = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward = (sin, cos), right = (-cos, sin)
    let wx = sy * fwd - cy * side;
    let wz = cy * fwd + sy * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }
    const ctl = input.locked && !free;

    if (c.mode === 'plane') {
      if (ctl && input.hit('KeyF') && game.plane.canJump) game.jumpFromPlane(c);
      return;
    }
    if (c.mode === 'freefall') {
      c.yaw = this.yaw;
      const dive = clamp(-Math.sin(this.pitch), 0, 1);
      const hs = fwd > 0 ? 27 * (1 - dive * 0.75) : wl > 0 ? 10 : 4;
      const vs = 40 + dive * 24 - (fwd < 0 ? 6 : 0);
      c.airStep(dt, ctl ? wx : 0, ctl ? wz : 0, hs, vs);
      const ground = Math.max(0, game.world.heightAt(c.pos.x, c.pos.z));
      if ((c.mode as string) === 'freefall' && (c.pos.y - ground < 92 || (ctl && input.hit('KeyF') && game.plane.sinceJump(c) > 0.8))) {
        c.mode = 'chute';
        c.vel.y *= 0.35;
        game.audio.ui('chute');
      }
      return;
    }
    if (c.mode === 'chute') {
      c.yaw = this.yaw;
      const hs = fwd > 0 ? 15 : fwd < 0 ? 4 : 10;
      const vs = fwd > 0 ? 9.5 : fwd < 0 ? 4.6 : 6.4;
      // canopies always carry you forward; A/D only nudges
      const gx = sy + (ctl ? -cy * side * 0.5 : 0);
      const gz = cy + (ctl ? sy * side * 0.5 : 0);
      const gl = Math.hypot(gx, gz);
      if (c.airStep(dt, gx / gl, gz / gl, hs, vs)) {
        game.audio.ui('land');
        game.effects.dust(c.pos.x, c.pos.y, c.pos.z, 8);
        game.onLanded(c);
      }
      return;
    }

    // ------------------------------------------------------------ ground
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    if (ctl) {
      if (input.hit('KeyC') || input.hit('ControlLeft')) c.crouch = !c.crouch;
      let jump = false;
      if (input.hit('Space')) {
        if (c.crouch) c.crouch = false;
        else jump = true;
      }
      const w = c.weapon;
      c.sprint = (input.down('ShiftLeft') || (this.autoRun && !input.down('ShiftLeft'))) && fwd > 0 && !c.crouch && !input.rmb && !c.heal && c.reloadT < 0;
      if (this.autoRun && c.crouch) c.sprint = false;
      c.ads = input.rmb && !looking && !!w && !c.sprint && c.reloadT < 0 && !c.heal && c.throwT < 0 && !c.swimming;
      // lean around corners (Q / E); stops short of walls
      let peek = c.sprint || c.swimming ? 0 : (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
      if (peek !== 0) {
        const rx = -Math.cos(c.yaw) * peek;
        const rz = Math.sin(c.yaw) * peek;
        if (game.world.raycast(c.pos.x, c.pos.y + c.eyeHeight(), c.pos.z, rx, 0, rz, 0.75, _hit, false)) peek *= clamp((_hit.t - 0.3) / 0.45, 0, 1);
      }
      c.peek += (peek - c.peek) * damp(10, dt);
      if (Math.abs(c.peek) < 0.002) c.peek = 0;
      if (input.hit('KeyB') && w && w.def.auto) {
        w.semi = !w.semi;
        game.notify(w.semi ? '단발 사격으로 전환' : '연사 사격으로 전환');
        game.audio.ui('click');
      }
      if (input.mmbHit()) game.placePing();
      c.move(dt, wx, wz, wl > 0 ? c.moveSpeed() : 0, jump);
      if (wl > 0 && c.heal && c.sprint) c.cancelHeal();

      // weapons
      if (input.hit('Digit1')) c.switchTo(0);
      if (input.hit('Digit2')) c.switchTo(1);
      if (input.hit('Digit3')) c.switchTo(2);
      if (input.hit('KeyX')) c.switchTo(-1);
      if (input.wheel !== 0) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.hit('KeyR')) c.startReload();
      if (input.hit('KeyG')) c.startThrow();
      if (input.hit('Digit4')) this.heal('medkit');
      if (input.hit('Digit5')) this.heal('bandage');
      if (input.hit('Digit6')) this.heal('drink');
      if (input.hit('KeyH')) {
        if (c.hp < 45 && c.medkits > 0) this.heal('medkit');
        else if (c.hp < 75 && c.bandages > 0) this.heal('bandage');
        else if (c.medkits > 0 && c.hp < 100) this.heal('medkit');
        else this.heal('drink');
      }
      if (w) {
        const full = w.def.auto && !w.semi;
        let trigger = !looking && (full ? input.lmb : input.lmbHit());
        // auto-fire: pull the trigger while the crosshair rests on an enemy
        if (game.autoFire && !looking && !c.heal && c.throwT < 0 && !c.swimming && c.reloadT < 0) {
          this.autoT -= dt;
          if (this.autoT <= 0) {
            this.autoT = 0.06;
            this.autoTarget = this.crosshairOnEnemy();
          }
          const cadence = full ? 0 : Math.max(0.22, 60 / w.def.rpm);
          if (this.autoTarget && w.ammo > 0 && game.time - this.lastShot >= cadence) trigger = true;
        } else this.autoTarget = false;
        if (trigger) {
          if (c.heal) c.cancelHeal();
          if (c.canFire()) {
            this.shoot();
            this.lastShot = game.time;
          }
          else if (w.ammo <= 0 && c.reloadT < 0 && input.lmbHit()) {
            if (!c.startReload()) game.audio.ui('empty');
          }
        }
        if (w.ammo <= 0 && c.reloadT < 0 && c.fireCd <= 0 && c.ammo[w.def.ammo] > 0 && !input.lmb) c.startReload();
      } else if (input.lmbHit() && !c.heal && c.throwT < 0 && !c.swimming) {
        game.combat.melee(c);
      }
      if (input.hit('KeyF') && this.near) this.pickup(this.near, true);
    } else {
      c.sprint = false;
      c.ads = false;
      c.peek *= 1 - damp(10, dt);
      c.move(dt, this.autoRun ? wx : 0, this.autoRun ? wz : 0, this.autoRun ? c.moveSpeed() : 0, false);
    }
    this.spread = c.spreadAngle();

    // looting: prompt for the closest item, hoover up the obvious stuff
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.12;
      c.inBuilding = game.world.buildingAt(c.pos.x, c.pos.z, c.pos.y);
      this.scanLoot();
    }
  }

  private heal(kind: 'bandage' | 'medkit' | 'drink'): void {
    const c = this.c;
    if (c.startHeal(kind)) {
      c.ads = false;
    } else if (kind === 'medkit' && c.medkits > 0 && c.hp >= 100) this.game.banner('체력이 가득 찼습니다', '', 1.2);
    else if (kind === 'bandage' && c.bandages > 0 && c.hp >= 75) this.game.banner('붕대는 체력 75까지만 회복됩니다', '', 1.6);
  }

  private cycle(dir: number): void {
    const c = this.c;
    for (let k = 1; k <= 3; k++) {
      const s = (((c.active < 0 ? (dir > 0 ? -1 : 3) : c.active) + dir * k) % 3 + 3) % 3;
      if (c.weapons[s]) {
        c.switchTo(s);
        return;
      }
    }
  }

  private scanLoot(): void {
    const c = this.c;
    const game = this.game;
    const list = game.loot.query(c.pos.x, c.pos.z, 2.6, this.nearList);
    let best: LootItem | null = null;
    let bd = 2.3;
    for (let i = list.length - 1; i >= 0; i--) {
      const li = list[i];
      if (!li.alive || Math.abs(li.y - c.pos.y) > 1.7) {
        list.splice(i, 1);
        continue;
      }
      const d = Math.hypot(li.x - c.pos.x, li.z - c.pos.z);
      // walk-over pickups
      if (d < 1.45 && this.autoTake(li)) {
        list.splice(i, 1);
        continue;
      }
      // favour what the camera is pointed at
      const dot = d > 0.2 ? ((li.x - c.pos.x) * c.fx() + (li.z - c.pos.z) * c.fz()) / d : 1;
      const score = d - dot * 0.5;
      if (d < 2.3 && score < bd) {
        bd = score;
        best = li;
      }
    }
    this.near = best;
  }

  private autoTake(li: LootItem): boolean {
    const c = this.c;
    const it = li.item;
    if (it.kind === 'weapon') {
      const def = WEAPONS[it.sub!];
      if (!c.hasFreeSlotFor(def)) return false;
    } else if (it.kind === 'helmet') {
      if (it.n <= c.helmet) return false;
    } else if (it.kind === 'vest') {
      if (it.n <= c.vest) return false;
    }
    return this.pickup(li, false);
  }

  pickup(li: LootItem, announce: boolean): boolean {
    const c = this.c;
    const game = this.game;
    if (!li.alive || !c.alive || c.mode !== 'ground') return false;
    const dropped = c.take(li.item);
    if (dropped === null) {
      if (announce) game.banner('더 이상 가질 수 없습니다', itemLabel(li.item), 1.2);
      return false;
    }
    game.loot.remove(li);
    if (dropped.length) game.loot.scatter(dropped, c.pos.x + c.fx() * 0.8, c.pos.y, c.pos.z + c.fz() * 0.8, li.building, li.upstairs);
    game.audio.ui(li.item.kind === 'weapon' || li.item.kind === 'helmet' || li.item.kind === 'vest' ? 'equip' : 'pickup');
    game.pickupToast(itemLabel(li.item));
    if (this.near === li) this.near = null;
    return true;
  }

  /** drop the weapon in a slot at the player's feet */
  dropSlot(slot: number): void {
    const c = this.c;
    const w = c.weapons[slot];
    if (!w || c.mode !== 'ground') return;
    c.weapons[slot] = null;
    if (c.active === slot) {
      c.active = -1;
      for (let s = 0; s < 3; s++) if (c.weapons[s]) {
        c.active = s;
        break;
      }
      c.reloadT = -1;
    }
    c.syncModel();
    this.game.loot.scatter(w.scope > 0 ? [{ kind: 'weapon', sub: w.def.id, n: w.ammo }, { kind: 'scope', n: w.scope }] : [{ kind: 'weapon', sub: w.def.id, n: w.ammo }], c.pos.x + c.fx() * 0.9, c.pos.y, c.pos.z + c.fz() * 0.9, c.inBuilding, false);
    this.game.audio.ui('equip');
  }

  /** is the centre of the screen on a living enemy within this gun's useful range? */
  private crosshairOnEnemy(): boolean {
    const c = this.c;
    const w = c.weapon;
    if (!w) return false;
    const game = this.game;
    const cam = game.camera;
    cam.getWorldDirection(_f);
    const skip = this.scoped ? 0.2 : this.camDist + 0.35;
    const ox = cam.position.x + _f.x * skip;
    const oy = cam.position.y + _f.y * skip;
    const oz = cam.position.z + _f.z * skip;
    let dist = Math.min(w.def.falloffEnd, w.def.botRange * 3.5);
    if (game.world.raycast(ox, oy, oz, _f.x, _f.y, _f.z, dist, _hit)) dist = _hit.t;
    const ch = game.combat.rayChars(ox, oy, oz, _f.x, _f.y, _f.z, dist, c);
    return !!ch.c && ch.c.mode === 'ground';
  }

  private shoot(): void {
    const c = this.c;
    const game = this.game;
    const cam = game.camera;
    const def = c.weapon!.def;
    cam.getWorldDirection(_f);
    // find what the crosshair is resting on, starting past the player's shoulder
    const skip = this.scoped ? 0.2 : this.camDist + 0.35;
    const ox = cam.position.x + _f.x * skip;
    const oy = cam.position.y + _f.y * skip;
    const oz = cam.position.z + _f.z * skip;
    let dist = 700;
    if (game.world.raycast(ox, oy, oz, _f.x, _f.y, _f.z, dist, _hit)) dist = _hit.t;
    const ch = game.combat.rayChars(ox, oy, oz, _f.x, _f.y, _f.z, dist, c);
    if (ch.c) dist = ch.t;
    _aim.set(ox + _f.x * dist, oy + _f.y * dist, oz + _f.z * dist);
    // bullets leave from the head line so cover behaves as it looks
    const lean = 0.14 + c.peek * 0.32;
    const ex = c.pos.x - Math.cos(c.yaw) * lean;
    const ey = c.pos.y + c.eyeHeight() - Math.abs(c.peek) * 0.06;
    const ez = c.pos.z + Math.sin(c.yaw) * lean;
    _p.set(_aim.x - ex, _aim.y - ey, _aim.z - ez);
    if (_p.length() < 1.6) _p.copy(_f);
    _p.normalize();
    game.combat.fire(c, ex, ey, ez, _p);
    // recoil
    const k = (c.ads ? 0.72 : 1) * (c.crouch ? 0.8 : 1);
    const kick = ((def.recoil * (0.75 + Math.random() * 0.5) * Math.PI) / 180) * k;
    this.pitch = clamp(this.pitch + kick, -1.45, 1.45);
    this.recover += kick * 0.55;
    this.yaw += ((Math.random() - 0.5) * def.recoil * 0.55 * Math.PI) / 180;
    this.shakeAmp = Math.min(0.6, this.shakeAmp + def.recoil * 0.06);
  }

  // -------------------------------------------------------------- camera

  updateCamera(dt: number): void {
    const game = this.game;
    const c = this.c;
    const cam = game.camera;
    const cp = Math.cos(this.pitch);
    const camYaw = this.yaw + this.freeLook;
    _f.set(Math.sin(camYaw) * cp, Math.sin(this.pitch), Math.cos(camYaw) * cp);
    let targetFov = 66;
    this.scoped = false;

    if (c.mode === 'plane') {
      const pl = game.plane;
      _piv.copy(pl.pos);
      const dist = 34;
      cam.position.copy(_piv).addScaledVector(_f, -dist);
      cam.position.y += 6;
      targetFov = 62;
    } else if (c.mode === 'freefall' || c.mode === 'chute') {
      _piv.set(c.pos.x, c.pos.y + (c.mode === 'chute' ? 2.4 : 1.0), c.pos.z);
      const want = c.mode === 'chute' ? 9.5 : 6.5;
      this.camDist = lerp(this.camDist, want, damp(4, dt));
      cam.position.copy(_piv).addScaledVector(_f, -this.camDist);
      cam.position.y += 1.2;
      const floor = game.world.heightAt(cam.position.x, cam.position.z) + 0.6;
      if (cam.position.y < floor) cam.position.y = floor;
      targetFov = c.mode === 'freefall' ? 74 : 68;
    } else if (!c.alive) {
      const sp = game.spectate;
      if (sp) {
        // over-the-shoulder view of whoever is being watched
        const pitch = clamp(sp.pitch * 0.6 - 0.12, -0.9, 0.5);
        _f.set(Math.sin(sp.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(sp.yaw) * Math.cos(pitch));
        _piv.set(sp.pos.x - Math.cos(sp.yaw) * 0.45, sp.pos.y + (sp.mode === 'ground' ? sp.eyeHeight() + 0.15 : 1.4), sp.pos.z + Math.sin(sp.yaw) * 0.45);
        let dist = sp.mode === 'ground' ? 3.4 : 7;
        if (game.world.raycast(_piv.x, _piv.y, _piv.z, -_f.x, -_f.y, -_f.z, dist + 0.3, _hit, false)) dist = Math.max(0.4, _hit.t - 0.3);
        this.specPos.copy(_piv).addScaledVector(_f, -dist);
        if (cam.position.distanceToSquared(this.specPos) > 400) cam.position.copy(this.specPos);
        else cam.position.lerp(this.specPos, damp(10, dt || 0.016));
        this.specDir.lerp(_f, damp(8, dt || 0.016)).normalize();
        _f.copy(this.specDir);
      } else {
        // slow orbit around the body
        const a = this.yaw + this.orbit;
        const pitch = clamp(this.pitch, -1.2, -0.12);
        _f.set(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch));
        _piv.set(c.pos.x, c.pos.y + 1.1, c.pos.z);
        let dist = 6.5;
        if (game.world.raycast(_piv.x, _piv.y, _piv.z, -_f.x, -_f.y, -_f.z, dist + 0.3, _hit, false)) dist = Math.max(0.6, _hit.t - 0.3);
        cam.position.copy(_piv).addScaledVector(_f, -dist);
      }
    } else {
      const w = c.weapon;
      const zoom = w ? c.zoom() : 1;
      const ads = c.ads && !game.autoPlay;
      this.adsT = lerp(this.adsT, ads ? 1 : 0, damp(ads ? 13 : 16, dt));
      const eye = c.eyeHeight();
      if (ads && zoom >= 3 && this.adsT > 0.75) {
        // looking through the optic
        this.scoped = true;
        const lx = 0.05 + c.peek * 0.32;
        cam.position.set(c.pos.x - Math.cos(c.yaw) * lx, c.pos.y + eye + 0.02 - Math.abs(c.peek) * 0.06, c.pos.z + Math.sin(c.yaw) * lx).addScaledVector(_f, 0.25);
        targetFov = 66 / zoom;
        this.camDist = 0.2;
      } else {
        const rx = -Math.cos(camYaw);
        const rz = Math.sin(camYaw);
        // keep the shoulder offset out of walls
        let sh = lerp(0.55, 0.66, this.adsT);
        const hx = c.pos.x;
        const hy = c.pos.y + eye + 0.1 + this.adsT * 0.1;
        const hz = c.pos.z;
        if (game.world.raycast(hx, hy, hz, rx, 0, rz, sh + 0.25, _hit, false)) sh = Math.max(0, _hit.t - 0.25);
        this.shoulder = lerp(this.shoulder, sh, damp(14, dt));
        const lean = this.shoulder + c.peek * 0.45;
        _piv.set(hx + rx * lean, hy - Math.abs(c.peek) * 0.05, hz + rz * lean);
        let want = lerp(c.sprint ? 3.3 : 3.0, 1.35, this.adsT);
        if (c.swimming) want = 3.6;
        if (game.world.raycast(_piv.x, _piv.y, _piv.z, -_f.x, -_f.y, -_f.z, want + 0.3, _hit, false)) want = Math.max(0.3, _hit.t - 0.3);
        // snap in instantly, ease back out
        this.camDist = want < this.camDist ? want : lerp(this.camDist, want, damp(7, dt));
        cam.position.copy(_piv).addScaledVector(_f, -this.camDist);
        cam.position.y += 0.08 * (1 - this.adsT);
        targetFov = lerp(c.sprint ? 70 : 66, 66 / Math.min(zoom, 1.6), this.adsT);
      }
    }
    _p.copy(cam.position).add(_f);
    cam.up.set(0, 1, 0);
    cam.lookAt(_p);
    if (c.peek !== 0 && c.alive && c.mode === 'ground') cam.rotateZ(-c.peek * 0.07);
    // trauma shake
    if (this.shakeAmp > 0.001) {
      this.shakeT += dt * 38;
      const s = this.shakeAmp * this.shakeAmp;
      cam.rotation.x += Math.sin(this.shakeT * 1.3) * 0.022 * s;
      cam.rotation.y += Math.cos(this.shakeT * 1.7) * 0.022 * s;
      cam.rotation.z += Math.sin(this.shakeT * 2.1) * 0.03 * s;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.4);
    }
    this.fov = lerp(this.fov, targetFov, damp(this.scoped ? 30 : 12, dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
