import { angleDiff, clamp, lerp } from '../core/math';
import type { BodyPart, Character, HealKind, Mode } from '../entities/Character';
import type { Game } from '../Game';
import { HEAL, WEAPONS, type Item } from '../items/defs';
import type { LootItem } from '../items/Loot';
import type { Packet, Room, StartMsg } from './Room';

/**
 * In-match synchronisation for one room.
 *
 * Every character has an owner: a human's own client runs that human, and the
 * host (the first player still in the match) runs every bot, the storm and the
 * supply drops. Owners send compact snapshots a few times a second; everyone
 * else plays them back with a small delay so motion stays smooth. Gameplay
 * events (hits, kills, loot taken or dropped, shots, grenades) ride along in
 * the same packets. Hits are decided by the shooter and applied by the
 * target's owner. When a player drops out, the host's AI takes their
 * character over; when the host leaves, the next player becomes host.
 */

const MODES: Mode[] = ['plane', 'freefall', 'chute', 'ground', 'dead'];
const PARTS: BodyPart[] = ['head', 'body', 'limb'];
const HEALS: HealKind[] = ['bandage', 'medkit', 'drink'];
const WIDS = Object.keys(WEAPONS);
/** message budget per second for the whole room (Supabase counts every delivery) */
const BUDGET = 72;

const F_CROUCH = 1;
const F_SPRINT = 2;
const F_ADS = 4;
const F_GROUND = 8;
const F_SWIM = 16;

interface Snap {
  t: number;
  a: number[];
}
interface Remote {
  sender: string;
  buf: Snap[];
  applied: Snap | null;
  wKey: number;
  gearKey: number;
}
interface ShotFx {
  sender: string;
  st: number;
  g: number;
  x: number;
  y: number;
  z: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const now = () => performance.now() / 1000;

export class NetSync {
  readonly mid: number;
  readonly slot: number;
  host = false;
  private byGid: Character[] = [];
  private remotes = new Map<number, Remote>();
  private out: (string | number)[][] = [];
  private shots: ShotFx[] = [];
  private offs = new Map<string, number>();
  private ivs = new Map<string, number>();
  private sendT = 0;
  private applying = false;
  private dropped = new Set<number>();
  private disposed = false;

  constructor(private game: Game, private room: Room, private start: StartMsg, slot: number) {
    this.mid = start.mid;
    this.slot = slot;
    const H = start.roster.length;
    // local index 0 is always this client's player; everyone else keeps their global order
    for (let g = 0; g < game.chars.length; g++) {
      const local = g === slot ? 0 : g < slot ? g + 1 : g;
      const c = game.chars[local];
      c.netId = g;
      this.byGid[g] = c;
      if (g < H) c.name = start.roster[g].name;
    }
    const loot = game.loot;
    loot.onSpawn = (li) => {
      if (!this.applying) this.lootSpawn(li);
    };
    loot.onRemove = (li) => {
      if (!this.applying) this.out.push(['lr', li.id]);
    };
    this.refresh(true);
  }

  // ------------------------------------------------------------ ownership

  private participating(id: string): boolean {
    if (id === this.room.me.id) return true;
    const m = this.room.members.find((x) => x.id === id);
    return !!m && !(m.state === 'lobby' && m.left === this.mid);
  }
  private hostId(): string {
    for (const r of this.start.roster) if (this.participating(r.id)) return r.id;
    return this.room.me.id;
  }
  private ownerOf(g: number, host: string): string {
    const r = this.start.roster[g];
    if (r && this.participating(r.id)) return r.id;
    return host;
  }
  /** number of people still in this match */
  players(): number {
    let n = 0;
    for (const r of this.start.roster) if (this.participating(r.id)) n++;
    return n;
  }

  /** recompute who runs what (room membership changed) */
  refresh(init = false): void {
    if (this.disposed) return;
    const me = this.room.me.id;
    const host = this.hostId();
    this.host = host === me;
    this.game.zone.follower = !this.host;
    const H = this.start.roster.length;
    for (let g = 0; g < this.byGid.length; g++) {
      const c = this.byGid[g];
      const mine = this.ownerOf(g, host) === me;
      if (init) {
        c.remote = !mine;
        if (!mine) this.remotes.set(g, { sender: '', buf: [], applied: null, wKey: -9, gearKey: -9 });
      } else if (mine && c.remote) this.adopt(c);
      else if (!mine && !c.remote) {
        c.remote = true;
        this.remotes.set(g, { sender: '', buf: [], applied: null, wKey: -9, gearKey: -9 });
      }
      // a player who walked out is handed to the AI, and everyone sees that in the name
      if (!init && g < H && !this.dropped.has(g) && !this.participating(this.start.roster[g].id)) {
        this.dropped.add(g);
        c.name = `${this.start.roster[g].name} (AI)`;
      }
    }
  }

  /** this client starts running a character someone else was running */
  private adopt(c: Character): void {
    c.remote = false;
    this.remotes.delete(c.netId);
    if (!c.alive) return;
    // snapshots only carry what is visible; give the AI a usable kit
    for (const w of c.weapons) {
      if (!w) continue;
      w.ammo = w.def.mag;
      c.ammo[w.def.ammo] = Math.max(c.ammo[w.def.ammo], 60);
    }
    if (c.active < 0) c.active = c.weapons.findIndex((w) => !!w);
    c.bandages = Math.max(c.bandages, 2);
    c.reloadT = -1;
    c.heal = null;
    c.throwT = -1;
    c.punchT = -1;
    c.fireCd = 0.5;
    c.grounded = c.mode === 'ground';
    c.vel.y = 0;
    c.inBuilding = this.game.world.buildingAt(c.pos.x, c.pos.z, c.pos.y);
    c.syncModel();
    this.game.bots[c.id - 1]?.reset();
  }

  // ------------------------------------------------------------- outgoing

  hit(target: Character, from: Character, amount: number, part: BodyPart, weapon: string, dist: number): void {
    this.out.push(['h', target.netId, from.netId, r2(amount), PARTS.indexOf(part), weapon, Math.round(dist)]);
  }
  kill(victim: Character, killer: Character | null, weapon: string, head: boolean, dist: number): void {
    this.out.push(['k', victim.netId, killer ? killer.netId : -1, weapon, head ? 1 : 0, Math.round(dist)]);
  }
  shot(c: Character, x: number, y: number, z: number): void {
    this.out.push(['s', c.netId, r3(now()), r2(x), r2(y), r2(z)]);
  }
  grenade(c: Character, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.out.push(['g', c.netId, r2(x), r2(y), r2(z), r2(vx), r2(vy), r2(vz)]);
  }
  airdrop(x: number, z: number): void {
    this.out.push(['ad', r2(x), r2(z)]);
  }
  private lootSpawn(li: LootItem): void {
    const it = li.item;
    this.out.push(['ls', li.id, it.kind, it.sub ?? '', it.n, it.dur ?? -1, r2(li.x), r2(li.y), r2(li.z), li.building, li.upstairs ? 1 : 0]);
  }

  private snapshot(c: Character): number[] {
    const flags = (c.crouch ? F_CROUCH : 0) | (c.sprint ? F_SPRINT : 0) | (c.ads ? F_ADS : 0) | (c.grounded ? F_GROUND : 0) | (c.swimming ? F_SWIM : 0);
    const act = c.weapon;
    let back = -1;
    for (let i = 0; i < 3; i++) {
      const w = c.weapons[i];
      if (w && i !== c.active && i < 2) back = WIDS.indexOf(w.def.id);
    }
    const heal = c.heal ? HEALS.indexOf(c.heal.kind) + Math.min(0.99, c.heal.t / c.heal.dur) : -1;
    return [
      c.netId, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), r3(c.yaw), r3(c.pitch), r2(c.vel.x), r2(c.vel.y), r2(c.vel.z),
      MODES.indexOf(c.mode), flags, act ? WIDS.indexOf(act.def.id) : -1, back, act ? act.scope : 0,
      Math.ceil(c.hp), c.helmet, c.vest,
      c.reloadT >= 0 ? r2(1 - c.reloadT / c.reloadDur) : -1, r2(heal), r2(c.throwT), r2(c.punchT), r2(c.peek),
    ];
  }

  /** called once per simulation step: send when it is time */
  update(dt: number): void {
    if (this.disposed) return;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    const n = Math.max(2, this.players());
    const iv = 1 / clamp(BUDGET / (n * n), 3, 12);
    this.sendT = iv;
    if (this.players() <= 1) {
      // nobody to talk to
      this.out.length = 0;
      return;
    }
    const c: number[][] = [];
    for (const ch of this.byGid) {
      if (ch.remote || ch.mode === 'plane') continue;
      if (!ch.alive && ch.deadT > 1.5) continue;
      c.push(this.snapshot(ch));
    }
    const p: Packet = { f: this.room.me.id, m: this.mid, t: r3(now()), iv: r3(iv), c, e: this.out };
    if (this.host) p.z = this.game.zone.netState();
    this.out = [];
    this.room.send(p);
  }

  /** send whatever is queued right away (used just before leaving) */
  flush(): void {
    this.sendT = 0;
    this.update(0);
  }

  // ------------------------------------------------------------- incoming

  receive(p: Packet): void {
    if (this.disposed || p.m !== this.mid || p.f === this.room.me.id) return;
    const t = now();
    const o = t - p.t;
    const prev = this.offs.get(p.f);
    if (prev === undefined || o < prev) this.offs.set(p.f, o);
    this.ivs.set(p.f, p.iv);
    if (p.z && !this.host) {
      const ev = this.game.zone.applyNet(p.z);
      if (ev !== 'none') this.game.onZoneEvent(ev, false);
    }
    for (const a of p.c) {
      const r = this.remotes.get(a[0]);
      if (!r) continue;
      r.sender = p.f;
      const last = r.buf[r.buf.length - 1];
      if (last && last.t >= p.t) continue;
      r.buf.push({ t: p.t, a });
      if (r.buf.length > 10) r.buf.shift();
    }
    for (const e of p.e) this.event(e, p.f);
  }

  private event(e: (string | number)[], sender: string): void {
    const game = this.game;
    const n = (i: number) => e[i] as number;
    switch (e[0]) {
      case 'h': {
        const target = this.byGid[n(1)];
        if (target && !target.remote && target.alive) target.takeDamage(n(3), this.byGid[n(2)] ?? null, PARTS[n(4)] ?? 'body', String(e[5]), n(6));
        break;
      }
      case 'k': {
        const v = this.byGid[n(1)];
        if (v && v.remote && v.alive) game.onKill(v, n(2) >= 0 ? this.byGid[n(2)] ?? null : null, String(e[3]), !!n(4), n(5));
        break;
      }
      case 's':
        this.shots.push({ sender, st: n(2), g: n(1), x: n(3), y: n(4), z: n(5) });
        if (this.shots.length > 160) this.shots.shift();
        break;
      case 'g': {
        const c = this.byGid[n(1)];
        if (c && c.remote) game.combat.spawnGrenade(c, n(2), n(3), n(4), n(5), n(6), n(7), true);
        break;
      }
      case 'ls': {
        if (game.loot.byId.has(n(1))) break;
        const item: Item = { kind: e[2] as Item['kind'], n: n(4) };
        if (e[3]) item.sub = String(e[3]);
        if (n(5) >= 0) item.dur = n(5);
        this.applying = true;
        game.loot.spawn(item, n(6), n(7), n(8), n(9), !!n(10), n(1));
        this.applying = false;
        break;
      }
      case 'lr': {
        const li = game.loot.byId.get(n(1));
        if (!li) break;
        this.applying = true;
        game.loot.remove(li);
        this.applying = false;
        break;
      }
      case 'ad':
        game.airdrops.spawnAt(n(1), n(2));
        game.onAirdrop();
        break;
    }
  }

  // ------------------------------------------------------------- playback

  private delay(sender: string): number {
    return clamp((this.ivs.get(sender) ?? 0.2) * 1.5 + 0.08, 0.12, 0.6);
  }

  /** move every remote character along its snapshot stream */
  apply(dt: number): void {
    if (this.disposed) return;
    const t = now();
    // let the clock offset estimate creep up so a latency increase is picked up
    for (const [k, v] of this.offs) this.offs.set(k, v + dt * 0.02);
    for (const [g, r] of this.remotes) {
      const c = this.byGid[g];
      const buf = r.buf;
      if (!buf.length || !c.remote) continue;
      const rt = t - (this.offs.get(r.sender) ?? 0) - this.delay(r.sender);
      let i = 0;
      while (i + 1 < buf.length && buf[i + 1].t <= rt) i++;
      if (i > 0) buf.splice(0, i);
      const A = buf[0];
      const B = buf[1];
      const a = A.a;
      if (A !== r.applied) {
        r.applied = A;
        this.applyState(c, a, r);
      }
      if (!c.alive) continue;
      let x = a[1];
      let y = a[2];
      let z = a[3];
      let yaw = a[4];
      let pitch = a[5];
      if (B && rt > A.t) {
        const u = clamp((rt - A.t) / Math.max(0.001, B.t - A.t), 0, 1);
        const b = B.a;
        x = lerp(x, b[1], u);
        y = lerp(y, b[2], u);
        z = lerp(z, b[3], u);
        yaw = yaw + angleDiff(yaw, b[4]) * u;
        pitch = lerp(pitch, b[5], u);
      } else if (!B && rt > A.t && c.mode !== 'dead') {
        // ran out of data: carry on a little along the last velocity
        const e = Math.min(rt - A.t, 0.25);
        x += a[6] * e;
        z += a[8] * e;
        if (!(a[10] & F_GROUND)) y += a[7] * e;
      }
      if (c.mode === 'plane') continue;
      const jump = Math.hypot(x - c.pos.x, y - c.pos.y, z - c.pos.z);
      const k = jump > 6 ? 1 : 1 - Math.exp(-dt * 22);
      const px = c.pos.x;
      const pz = c.pos.z;
      c.pos.x += (x - c.pos.x) * k;
      c.pos.y += (y - c.pos.y) * k;
      c.pos.z += (z - c.pos.z) * k;
      c.yaw = yaw;
      c.pitch = pitch;
      if (dt > 0) {
        c.vel.x = (c.pos.x - px) / dt;
        c.vel.z = (c.pos.z - pz) / dt;
        c.vel.y = a[7];
      }
      c.speed = Math.hypot(c.vel.x, c.vel.z);
      if (c.mode === 'ground') {
        c.onHardFloor = c.pos.y > this.game.world.terrain.heightAt(c.pos.x, c.pos.z) + 0.05;
        c.footsteps(dt);
      }
    }
    // gunfire plays back on the same delayed timeline as the movement
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      const rt = t - (this.offs.get(s.sender) ?? 0) - this.delay(s.sender);
      if (s.st > rt) continue;
      const c = this.byGid[s.g];
      if (c && c.remote && c.alive) this.game.combat.replayShot(c, s.x, s.y, s.z);
      this.shots.splice(i--, 1);
    }
  }

  private applyState(c: Character, a: number[], r: Remote): void {
    const mode = MODES[a[9]] ?? 'ground';
    if (!c.alive) return;
    if (mode === 'dead') {
      // the kill event went missing; the snapshot still tells us
      this.game.onKill(c, null, '사망', false, 0);
      return;
    }
    if (mode !== c.mode) {
      if (c.mode === 'plane') {
        c.pos.set(a[1], a[2], a[3]);
        this.game.plane.noteJump(c);
      }
      if (mode === 'ground') c.inBuilding = this.game.world.buildingAt(a[1], a[3], a[2]);
      c.mode = mode;
    }
    const f = a[10];
    c.crouch = !!(f & F_CROUCH);
    c.sprint = !!(f & F_SPRINT);
    c.ads = !!(f & F_ADS);
    c.grounded = !!(f & F_GROUND);
    c.swimming = !!(f & F_SWIM);
    const wKey = a[11] * 10000 + a[12] * 10 + a[13];
    if (wKey !== r.wKey) {
      r.wKey = wKey;
      const mk = (i: number, scope: number) => (i >= 0 && WIDS[i] ? { def: WEAPONS[WIDS[i]], ammo: 0, scope, semi: false } : null);
      const act = mk(a[11], a[13]);
      const back = mk(a[12], 0);
      if (act && act.def.kind === 'pistol') c.weapons = [back, null, act];
      else c.weapons = [act, back, null];
      c.active = act ? (act.def.kind === 'pistol' ? 2 : 0) : -1;
      c.syncModel();
    }
    c.hp = a[14];
    const gearKey = a[15] * 10 + a[16];
    if (gearKey !== r.gearKey) {
      r.gearKey = gearKey;
      c.helmet = a[15];
      c.vest = a[16];
      c.syncModel();
    }
    const w = c.weapon;
    if (a[17] >= 0 && w) {
      c.reloadDur = w.def.reload;
      c.reloadT = (1 - a[17]) * c.reloadDur;
    } else c.reloadT = -1;
    if (a[18] >= 0) {
      const kind = HEALS[Math.floor(a[18])] ?? 'bandage';
      const dur = HEAL[kind].time;
      c.heal = { kind, t: (a[18] % 1) * dur, dur };
    } else c.heal = null;
    c.throwT = a[19];
    c.punchT = a[20];
    c.peek = a[21];
  }

  /** this client is leaving the match (back to the room or menu) */
  leave(): void {
    if (this.disposed) return;
    this.flush();
    // tells the others this player is out, so the next player takes over the bots
    this.room.setState('lobby', this.mid);
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    const loot = this.game.loot;
    loot.onSpawn = loot.onRemove = null;
    this.game.zone.follower = false;
    for (const c of this.game.chars) c.remote = false;
  }
}
