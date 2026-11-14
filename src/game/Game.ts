import * as THREE from 'three';
import { AudioSys } from './audio/AudioSys';
import { Combat } from './combat/Combat';
import { Effects } from './combat/Effects';
import { QUALITY, TOTAL_PLAYERS, type Difficulty, type Quality } from './config';
import { clamp, mulberry32, rrange, type Rng } from './core/math';
import { Bot } from './entities/Bot';
import { Character, type BodyPart } from './entities/Character';
import { OUTFITS } from './entities/CharacterModel';
import { Plane } from './entities/Plane';
import { Player } from './entities/Player';
import { Input } from './Input';
import { SCOPES, itemLabel, itemRarity } from './items/defs';
import { Loot } from './items/Loot';
import { PostFX } from './render/PostFX';
import { HudStore, type FeedEntry, type SlotInfo } from './store';
import { Airdrops } from './world/Airdrops';
import { World } from './world/World';
import { Zone } from './world/Zone';

const BOT_NAMES = [
  '은빛늑대', 'ShadowFox', '밤비', 'IronMoth', '돌격토끼', 'Quasar', '서리', 'NovaKid', '삼색고양이', 'Driftwood', '붉은매', 'Pixel',
  '한라봉', 'GhostPepper', '도깨비', 'Marble', '솔방울', 'Tango7', '번개', 'Lynx', '모래시계', 'Echo', '감자칩', 'Juniper', '바람개비',
  'Onyx', '초승달', 'Rook', '물안개', 'Vesper', '단풍', 'Koi', '자갈치', 'Mango', '은하수', 'Flint', '돌하르방', 'Zephyr', '개나리',
  'Basalt', '노을', 'Cobalt', '청설모', 'Fable', '두루미',
];

export interface DamageMark {
  /** world-space bearing the shot came from */
  angle: number;
  t: number;
}

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 1, 0.12, 4200);
  world = new World();
  post!: PostFX;
  input: Input;
  audio = new AudioSys();
  effects!: Effects;
  loot = new Loot();
  combat: Combat;
  zone = new Zone();
  plane = new Plane();
  chars: Character[] = [];
  bots: Bot[] = [];
  player!: Character;
  ctl!: Player;
  store: HudStore;
  time = 0;
  quality: Quality;
  manual = false;
  playerName = '플레이어';
  mapCanvas: HTMLCanvasElement | null = null;
  /** who the camera follows once the player is out */
  spectate: Character | null = null;
  // high frequency HUD data, read directly by the canvas overlay
  hitT = -9;
  difficulty: Difficulty = 'normal';
  airdrops: Airdrops;
  /** floating damage numbers for hits the player lands */
  damageNumbers: { x: number; y: number; z: number; amount: number; head: boolean; t: number }[] = [];
  hitHead = false;
  killT = -9;
  damageMarks: DamageMark[] = [];
  private hurtFlash = 0;
  private raf = 0;
  private last = 0;
  private rng: Rng = mulberry32(1);
  private matchSeed = 1;
  private frameN = 0;
  private hudT = 0;
  private feedId = 1;
  private feed: FeedEntry[] = [];
  private bannerT = 0;
  private toastT = 0;
  private matchTime = 0;
  private menuAngle = 0;
  private zoneTickT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private ended = false;
  private disposed = false;
  private puffT = 0;
  /** dynamic resolution: shrinks when the frame rate drops, recovers when it is stable */
  private resScale = 1;
  private goodSeconds = 0;
  debugCam: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, quality: Quality, store: HudStore) {
    this.quality = quality;
    this.store = store;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.far = q.viewDistance + 1200;
    this.input = new Input(canvas);
    this.combat = new Combat(this);
    this.airdrops = new Airdrops(this);
    this.input.onLockChange = (locked) => {
      const ph = this.store.state.phase;
      const live = ph === 'flight' || ph === 'drop' || ph === 'playing';
      if (!locked && live && !this.input.wantFree) this.store.emit({ paused: true });
      else if (locked && this.store.state.paused) this.store.emit({ paused: false });
    };
  }

  async init(): Promise<void> {
    const q = QUALITY[this.quality];
    this.store.emit({ phase: 'loading', quality: this.quality, progress: 0.02, progressLabel: '엔진 초기화 중' });
    await this.world.generate(this.scene, this.renderer, q, async (p, label) => {
      this.store.emit({ progress: p, progressLabel: label });
      await new Promise((r) => setTimeout(r, 30));
    });
    if (this.disposed) return;
    this.store.emit({ progress: 0.92, progressLabel: '생존자 배치 중' });
    await new Promise((r) => setTimeout(r, 30));
    this.effects = new Effects(this.scene.fog as THREE.FogExp2);
    this.scene.add(this.effects.group, this.airdrops.group, this.loot.group, this.combat.group, this.zone.mesh, this.plane.group);
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      const isPlayer = i === 0;
      const c = new Character(this, i, isPlayer ? this.playerName : BOT_NAMES[(i - 1) % BOT_NAMES.length], isPlayer, isPlayer ? 0 : 1 + ((i * 5) % (OUTFITS.length - 1)));
      this.chars.push(c);
      this.scene.add(c.model.group);
      if (isPlayer) {
        this.player = c;
        this.ctl = new Player(this, c);
      } else {
        this.bots.push(new Bot(this, c, mulberry32(977 + i * 131)));
      }
    }
    this.mapCanvas = this.world.renderMap(1024);
    this.post = new PostFX(this.renderer, this.scene, this.camera, q);
    this.resize();
    window.addEventListener('resize', this.resize);
    // compile shaders up front so the first match does not hitch
    try {
      this.camera.position.set(300, 160, 300);
      this.camera.lookAt(0, 0, 0);
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* non fatal */
    }
    this.input.wantFree = true;
    this.store.emit({ phase: 'menu', progress: 1, progressLabel: '' });
    this.last = performance.now();
    if (!this.manual) this.raf = requestAnimationFrame(this.frame);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = QUALITY[this.quality];
    const pr = Math.min(window.devicePixelRatio, q.maxPixelRatio) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, pr);
  };

  // ------------------------------------------------------------ match flow

  startMatch(name: string): void {
    this.playerName = name.trim().slice(0, 16) || '플레이어';
    this.player.name = this.playerName;
    this.matchSeed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    this.rng = mulberry32(this.matchSeed);
    this.audio.resume();
    this.loot.clear();
    this.loot.populate(this.world.lootSpots, this.matchSeed);
    this.effects.clear();
    this.combat.clear();
    this.airdrops.clear();
    this.damageNumbers.length = 0;
    this.zone.stop();
    this.zone.start(this.world, this.rng);
    this.plane.start(this.rng);
    this.feed = [];
    this.damageMarks.length = 0;
    this.hitT = this.killT = -9;
    this.matchTime = 0;
    this.ended = false;
    this.spectate = null;
    for (const c of this.chars) {
      c.reset();
      c.pos.copy(this.plane.pos);
    }
    // every bot picks somewhere to land that the flight path can reach
    const sites = this.world.sites;
    for (const b of this.bots) {
      b.reset();
      let tx = 0;
      let tz = 0;
      let at = 0.5;
      for (let k = 0; k < 10; k++) {
        if (this.rng() < 0.82) {
          const s = sites[Math.floor(this.rng() * sites.length)];
          const a = this.rng() * Math.PI * 2;
          const r = Math.sqrt(this.rng()) * s.radius * 0.8;
          tx = s.x + Math.cos(a) * r;
          tz = s.z + Math.sin(a) * r;
        } else {
          const a = this.rng() * Math.PI * 2;
          const r = Math.sqrt(this.rng()) * 420;
          tx = Math.cos(a) * r;
          tz = Math.sin(a) * r;
        }
        const cl = this.plane.closest(tx, tz);
        at = cl.t;
        if (cl.miss < 330 && cl.t > 0.1 && cl.t < 0.9 && this.world.heightAt(tx, tz) > 1) break;
      }
      b.dropX = tx;
      b.dropZ = tz;
      b.jumpAt = clamp(at - 0.03 + rrange(this.rng, -0.02, 0.02), 0.08, 0.9);
    }
    this.ctl.reset();
    this.ctl.yaw = Math.atan2(this.plane.dir.x, this.plane.dir.z);
    this.input.wantFree = false;
    this.input.lock();
    this.store.emit({
      phase: 'flight', paused: false, result: null, feed: [], kills: 0, alive: TOTAL_PLAYERS, inventory: false, map: false,
      banner: '강하 지점을 선택하세요', bannerSub: 'F 키로 수송기에서 뛰어내립니다', bannerT: 1, prompt: '', hp: 100, boost: 0, near: [], spectating: '',
    });
    this.bannerT = 5;
  }

  toMenu(): void {
    this.zone.stop();
    this.plane.stop();
    this.audio.setEngine(0);
    this.audio.setWind(0);
    for (const c of this.chars) c.model.group.visible = false;
    this.spectate = null;
    this.input.wantFree = true;
    this.input.unlock();
    this.store.emit({ phase: 'menu', paused: false, result: null, inventory: false, map: false });
  }

  resume(): void {
    this.audio.resume();
    this.input.wantFree = false;
    this.input.lock();
    this.store.emit({ paused: false, inventory: false, map: false });
  }

  setInventory(open: boolean): void {
    if (this.store.state.inventory === open) return;
    this.input.wantFree = open;
    if (open) this.input.unlock();
    else this.input.lock();
    this.store.emit({ inventory: open, map: false });
  }

  uiOpen(): boolean {
    const s = this.store.state;
    return s.inventory || s.paused;
  }

  jumpFromPlane(c: Character): void {
    if (c.mode !== 'plane') return;
    c.mode = 'freefall';
    const side = ((c.id % 5) - 2) * 1.6;
    c.pos.set(this.plane.pos.x - this.plane.dir.z * side, this.plane.pos.y - 4, this.plane.pos.z + this.plane.dir.x * side);
    c.vel.set(this.plane.dir.x * this.plane.speed * 0.55, -6, this.plane.dir.z * this.plane.speed * 0.55);
    c.yaw = Math.atan2(this.plane.dir.x, this.plane.dir.z);
    this.plane.noteJump(c);
    if (c === this.player) {
      this.ctl.pitch = -0.7;
      this.store.emit({ phase: 'drop', banner: '', bannerSub: '', bannerT: 0 });
      this.bannerT = 0;
    }
  }

  onLanded(c: Character): void {
    c.inBuilding = this.world.buildingAt(c.pos.x, c.pos.z, c.pos.y);
    if (c === this.player) {
      const site = this.world.nearestSite(c.pos.x, c.pos.z);
      const near = Math.hypot(c.pos.x - site.x, c.pos.z - site.z) < site.radius + 40;
      this.store.emit({ phase: 'playing' });
      this.banner(near ? site.name : '야생 지대', '무기를 찾아 살아남으세요', 3.5);
    }
  }

  banner(text: string, sub: string, dur: number): void {
    this.bannerT = dur;
    this.store.emit({ banner: text, bannerSub: sub, bannerT: this.time });
  }
  pickupToast(label: string): void {
    this.toastT = 1.6;
    this.store.set({ action: `획득: ${label}`, actionProgress: -1 });
  }

  // ---------------------------------------------------------- game events

  onDamage(victim: Character, from: Character | null, amount: number, part: BodyPart): void {
    if (from === this.player && victim !== this.player && amount >= 0.5) {
      this.damageNumbers.push({ x: victim.pos.x, y: victim.pos.y + victim.height + 0.25, z: victim.pos.z, amount, head: part === 'head', t: this.time });
      if (this.damageNumbers.length > 24) this.damageNumbers.shift();
    }
    if (victim === this.player) {
      this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + amount / 60);
      if (amount > 1.5) {
        this.audio.ui('hurt');
        this.ctl.shakeAmp = Math.min(0.9, this.ctl.shakeAmp + 0.25 + amount / 90);
      }
      if (from && from !== victim) {
        const angle = Math.atan2(from.pos.x - victim.pos.x, from.pos.z - victim.pos.z);
        this.damageMarks.push({ angle, t: this.time });
        if (this.damageMarks.length > 6) this.damageMarks.shift();
      }
    } else if (from) {
      this.bots[victim.id - 1]?.onHit(from);
    }
  }

  onKill(victim: Character, killer: Character | null, weapon: string, head: boolean, dist: number): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.mode = 'dead';
    victim.deadT = 0;
    victim.heal = null;
    victim.reloadT = -1;
    victim.ads = false;
    // fall away from the shot
    if (killer && killer !== victim) {
      const dx = killer.pos.x - victim.pos.x;
      const dz = killer.pos.z - victim.pos.z;
      victim.anim.deadDir = dx * victim.fx() + dz * victim.fz() >= 0 ? 1 : -1;
    } else victim.anim.deadDir = 1;
    const alive = this.aliveCount();
    victim.placement = alive + 1;
    if (killer && killer !== victim) {
      killer.kills++;
      if (head) killer.headshots++;
      if (dist > killer.longestKill) killer.longestKill = dist;
    }
    // everything they carried ends up on the ground
    const items = victim.spill();
    if (items.length && victim.pos.y > -1.2) {
      const b = this.world.buildingAt(victim.pos.x, victim.pos.z, victim.pos.y);
      const up = b >= 0 && victim.pos.y > this.world.buildings[b].y + 2;
      this.loot.scatter(items, victim.pos.x, Math.max(victim.pos.y, this.world.heightAt(victim.pos.x, victim.pos.z)), victim.pos.z, b, up, this.rng);
    }
    victim.weapons = [null, null, null];
    victim.active = -1;
    victim.syncModel();
    const you = victim === this.player || killer === this.player;
    this.feed.push({
      id: this.feedId++, killer: killer && killer !== victim ? killer.name : '', victim: victim.name, weapon, head, you, t: this.time,
    });
    if (this.feed.length > 6) this.feed.shift();
    this.store.set({ feed: [...this.feed], alive });
    if (killer === this.player && victim !== this.player) {
      this.killT = this.time;
      this.audio.ui('kill');
      this.banner(`${victim.name} 처치`, `${this.player.kills} 킬${head ? ' · 헤드샷' : ''} · ${Math.round(dist)}m`, 2.6);
    }
    if (this.spectate === victim) this.spectateNext(killer);
    if (victim === this.player) this.finish(false, killer && killer !== victim ? killer.name : weapon);
    else if (alive === 1 && this.player.alive) this.finish(true, '');
    if (alive <= 1) {
      this.ended = true;
      this.zone.stop();
    }
  }

  private finish(won: boolean, killer: string): void {
    const p = this.player;
    if (won) {
      p.placement = 1;
      this.audio.ui('win');
    }
    this.input.wantFree = true;
    this.input.unlock();
    this.audio.setWind(0);
    this.store.emit({
      phase: won ? 'won' : 'dead',
      inventory: false,
      map: false,
      paused: false,
      scoped: false,
      result: {
        placement: p.placement, total: TOTAL_PLAYERS, kills: p.kills, damage: Math.round(p.damageDealt), headshots: p.headshots,
        longest: Math.round(p.longestKill), time: Math.round(this.matchTime), killer, won,
      },
    });
  }

  onPlayerHit(head: boolean, killed: boolean): void {
    this.hitT = this.time;
    this.hitHead = head;
    if (!killed) this.audio.ui(head ? 'head' : 'hit');
  }

  onNearMiss(dx: number, dz: number): void {
    // which ear the round passed
    const rx = -Math.cos(this.ctl.yaw);
    const rz = Math.sin(this.ctl.yaw);
    const l = Math.hypot(dx, dz) || 1;
    this.audio.whiz(clamp(-(dx * rx + dz * rz) / l, -1, 1));
    this.ctl.shakeAmp = Math.min(0.7, this.ctl.shakeAmp + 0.12);
  }

  noise(x: number, z: number, loud: number, src: Character | null): void {
    for (const b of this.bots) b.onNoise(x, z, loud, src);
  }

  shake(x: number, y: number, z: number, amount: number): void {
    const d = Math.hypot(x - this.camera.position.x, y - this.camera.position.y, z - this.camera.position.z);
    this.ctl.shakeAmp = Math.min(1.2, this.ctl.shakeAmp + amount * clamp(1 - d / 60, 0, 1) * 1.2);
  }

  /** follow the next living survivor (starting with whoever is given) */
  spectateNext(prefer?: Character | null): void {
    const alive = this.chars.filter((c) => c.alive && c !== this.player && c.mode !== 'plane');
    if (!alive.length) {
      this.spectate = null;
      this.store.emit({ spectating: '' });
      return;
    }
    let next = prefer && prefer.alive && prefer !== this.player ? prefer : null;
    if (!next) {
      const i = this.spectate ? alive.indexOf(this.spectate) : -1;
      next = alive[(i + 1) % alive.length];
    }
    this.spectate = next;
    this.store.emit({ spectating: next.name });
  }
  stopSpectate(): void {
    this.spectate = null;
    this.store.emit({ spectating: '' });
  }

  aliveCount(): number {
    let n = 0;
    for (const c of this.chars) if (c.alive) n++;
    return n;
  }

  // ------------------------------------------------------------------ loop

  /** test hook: advance and draw exactly one frame */
  step(dt: number): void {
    this.last = performance.now() - dt * 1000;
    this.frame(performance.now());
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(raw, 0.0005, 0.05);
    this.frameN++;
    this.fpsAcc += raw;
    this.fpsN++;
    const st = this.store.state;
    const phase = st.phase;
    const live = phase === 'flight' || phase === 'drop' || phase === 'playing' || phase === 'dead' || phase === 'won';

    if (phase === 'menu' || phase === 'loading') {
      this.menuAngle += dt * 0.035;
      const a = this.menuAngle;
      this.camera.position.set(Math.cos(a) * 330, 62 + Math.sin(a * 2.1) * 14, Math.sin(a) * 330);
      const gy = this.world.heightAt(this.camera.position.x, this.camera.position.z);
      if (this.camera.position.y < gy + 14) this.camera.position.y = gy + 14;
      this.camera.lookAt(Math.cos(a + 1.2) * 60, 14, Math.sin(a + 1.2) * 60);
      if (this.camera.fov !== 55) {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
      }
    } else if (live && !st.paused) {
      this.simulate(dt);
    }
    if (live) {
      this.ctl.updateCamera(st.paused ? 0 : dt);
      if (this.debugCam) {
        const d = this.debugCam;
        this.camera.position.set(d.x, d.y, d.z);
        this.camera.lookAt(d.tx, d.ty, d.tz);
      }
      // culling below needs this frame's camera, not last frame's
      this.camera.updateMatrixWorld();
      this.presentCharacters(st.paused ? 0 : dt);
    }
    this.camera.updateMatrixWorld();
    this.world.update(st.paused ? 0 : dt, this.camera);
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.ctl ? this.ctl.yaw : 0);

    // screen effects
    const u = this.post.uniforms;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    u.uDamage.value = live ? this.hurtFlash : 0;
    const hp = this.player ? this.player.hp : 100;
    u.uLowHp.value = live && this.player.alive ? clamp((32 - hp) / 32, 0, 1) : phase === 'dead' && !this.spectate ? 0.8 : 0;
    u.uScope.value = live && this.ctl.scoped ? 1 : 0;
    const out = live && this.player.alive && this.player.mode === 'ground' && this.zone.state !== 'idle' && !this.zone.inside(this.player.pos.x, this.player.pos.z);
    u.uOutside.value += ((out ? 1 : 0) - u.uOutside.value) * Math.min(1, dt * 4);
    this.post.render(dt);

    if (this.fpsAcc > 1) {
      const fps = this.fpsN / this.fpsAcc;
      if (!this.manual && !document.hidden && phase !== 'loading') {
        if (fps < 44 && this.resScale > 0.5) {
          this.resScale = Math.max(0.5, this.resScale - (fps < 30 ? 0.15 : 0.08));
          this.goodSeconds = 0;
          this.resize();
        } else if (fps > 57 && this.resScale < 1) {
          if (++this.goodSeconds >= 5) {
            this.resScale = Math.min(1, this.resScale + 0.06);
            this.goodSeconds = 0;
            this.resize();
          }
        } else this.goodSeconds = 0;
      }
      this.store.set({ fps: Math.round(this.fpsN / this.fpsAcc) });
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    if (live) this.syncHud(dt);
    else this.store.flush();
    this.input.endFrame();
  };

  private simulate(dt: number): void {
    const st = this.store.state;
    this.time += dt;
    const p = this.player;
    if (!this.ended && p.alive) this.matchTime += dt;
    // toggles
    const input = this.input;
    if (st.phase !== 'dead' && st.phase !== 'won') {
      if (input.hit('Tab') || (st.inventory && input.hit('Escape'))) this.setInventory(!st.inventory);
      if (input.hit('KeyM')) this.store.emit({ map: !st.map });
    }
    this.plane.update(dt);
    if (this.plane.active && this.plane.progress > 0.93) {
      // nobody rides the aircraft off the map
      for (const c of this.chars) if (c.mode === 'plane') this.jumpFromPlane(c);
    }
    for (const c of this.chars) if (c.mode === 'plane') c.pos.copy(this.plane.pos);

    const ev = this.zone.update(dt, this.world, this.rng, this.camera.position);
    if (ev === 'shrink') {
      this.audio.ui('zone');
      this.banner('폭풍이 좁혀옵니다', '안전 구역으로 이동하세요', 3.5);
    } else if (ev === 'next') {
      const z = this.zone;
      // phases 1-3 also bring a supply drop inside the next circle
      if (z.phase >= 1 && z.phase <= 3 && this.airdrops.spawn(z.nx, z.nz, z.nr, this.rng)) {
        this.banner('보급품 투하!', '빨간 연기를 따라가면 최고급 장비가 있습니다', 4);
        this.audio.ui('zone');
      } else {
        this.banner('새 안전 구역 지정', `${Math.round(z.timer)}초 후 폭풍이 다시 움직입니다`, 3.5);
      }
    }
    this.airdrops.update(dt, this.rng);

    this.ctl.update(dt);
    for (const b of this.bots) b.update(dt);
    for (const c of this.chars) c.tick(dt);
    this.combat.update(dt);

    // storm damage
    const dps = this.zone.dps();
    if (dps > 0) {
      this.zoneTickT -= dt;
      for (const c of this.chars) {
        if (!c.alive || c.mode !== 'ground') continue;
        if (!this.zone.inside(c.pos.x, c.pos.z)) c.takeDamage(dps * dt, null, 'limb', '폭풍', 0);
      }
      if (this.zoneTickT <= 0) this.zoneTickT = 1;
    }
    // marker smoke over fresh loot piles
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.22;
      for (const c of this.chars) {
        if (!c.alive && c.deadT > 0.8 && c.deadT < 40) {
          const d = Math.hypot(c.pos.x - this.camera.position.x, c.pos.z - this.camera.position.z);
          if (d < 160) this.effects.puff(c.pos.x, c.pos.y + 0.2, c.pos.z, 0.2, 0.75, 0.35);
        }
      }
    }
    this.effects.update(dt);
    this.loot.update(dt, this.camera.position, QUALITY[this.quality].lootRange);

    // ambience follows what the player is doing
    const falling = p.mode === 'freefall' ? 1 : p.mode === 'chute' ? 0.45 : 0;
    this.audio.setWind(falling > 0 ? falling : this.zone.state !== 'idle' && !this.zone.inside(p.pos.x, p.pos.z) && p.mode === 'ground' ? 0.3 : 0.04);
    const pd = this.plane.active ? Math.hypot(this.plane.pos.x - this.camera.position.x, this.plane.pos.y - this.camera.position.y, this.plane.pos.z - this.camera.position.z) : 9999;
    this.audio.setEngine(this.plane.active ? clamp(1.1 - pd / 600, 0, 1) : 0);
    this.effects.setViewport(this.renderer.domElement.height, this.camera.fov);
  }

  private presentCharacters(dt: number): void {
    _pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert());
    _frustum.setFromProjectionMatrix(_pm);
    const cam = this.camera.position;
    for (const c of this.chars) {
      if (c.mode === 'plane') {
        c.model.group.visible = false;
        continue;
      }
      const d = Math.hypot(c.pos.x - cam.x, c.pos.y - cam.y, c.pos.z - cam.z);
      _sphere.center.set(c.pos.x, c.pos.y + (c.mode === 'chute' ? 3 : 1), c.pos.z);
      _sphere.radius = c.mode === 'chute' ? 5 : 2.2;
      let step = 1;
      let visible = d < (c.alive ? 900 : 240) && _frustum.intersectsSphere(_sphere);
      if (c === this.player && this.ctl.scoped) visible = false;
      c.model.group.visible = visible;
      if (!visible) c.lod = 2;
      else if (!c.alive && c.deadT > 2) c.lod = 2;
      else if (d < 80 || c === this.player) c.lod = 0;
      else {
        // distant characters animate at a half or a quarter of the frame rate
        step = d < 200 ? 2 : 4;
        c.lod = (this.frameN + c.id) % step === 0 ? 1 : 2;
      }
      c.present(c.lod === 1 ? dt * step : dt);
    }
  }

  private syncHud(dt: number): void {
    this.hudT -= dt;
    this.bannerT -= dt;
    this.toastT -= dt;
    const st = this.store.state;
    const p = this.player;
    if (this.bannerT <= 0 && st.banner) this.store.set({ banner: '', bannerSub: '' });
    if (this.hudT > 0) {
      this.store.flush();
      return;
    }
    this.hudT = 0.08;
    const slots: (SlotInfo | null)[] = [];
    let changed = false;
    for (let i = 0; i < 3; i++) {
      const w = p.weapons[i];
      const prev = st.slots[i];
      if (!w) {
        slots.push(null);
        if (prev) changed = true;
        continue;
      }
      const reserve = p.ammo[w.def.ammo];
      const name = w.scope > 0 ? `${w.def.name} · ${SCOPES[w.scope].short}` : w.def.name;
      if (!prev || prev.id !== w.def.id || prev.ammo !== w.ammo || prev.reserve !== reserve || prev.name !== name) {
        changed = true;
        slots.push({ id: w.def.id, name, ammo: w.ammo, mag: w.def.mag, reserve });
      } else slots.push(prev);
    }
    let action = st.action;
    let actionProgress = st.actionProgress;
    if (p.heal) {
      action = p.heal.kind === 'bandage' ? '붕대 감는 중' : p.heal.kind === 'medkit' ? '구급상자 사용 중' : '에너지 드링크 마시는 중';
      actionProgress = p.heal.t / p.heal.dur;
    } else if (p.reloadT >= 0) {
      action = '재장전';
      actionProgress = 1 - p.reloadT / p.reloadDur;
    } else if (this.toastT > 0 && st.actionProgress < 0) {
      // keep the pickup toast
    } else {
      action = '';
      actionProgress = 0;
    }
    let prompt = '';
    if (p.mode === 'plane') prompt = this.plane.canJump ? 'F  강하' : '강하 가능 구역까지 대기 중';
    else if (p.mode === 'freefall') prompt = 'F  낙하산 펼치기 · W 전진 · 아래를 보면 급강하';
    else if (p.mode === 'chute') prompt = 'W 가속 · S 감속 · 마우스로 방향 전환';
    else if (p.alive && this.ctl.near) prompt = `F  ${itemLabel(this.ctl.near.item)}`;
    const zone = this.zone;
    const ammo = st.ammo;
    const ammoChanged = ammo['9mm'] !== p.ammo['9mm'] || ammo['5.56'] !== p.ammo['5.56'] || ammo['7.62'] !== p.ammo['7.62'] || ammo['12g'] !== p.ammo['12g'];
    let near = st.near;
    if (st.inventory) {
      const list = this.ctl.nearList.filter((l) => l.alive).slice(0, 10);
      if (list.length !== near.length || list.some((l, i) => near[i].id !== l.id)) near = list.map((l) => ({ id: l.id, label: itemLabel(l.item), rarity: itemRarity(l.item) }));
    } else if (near.length) near = [];
    this.store.set({
      hp: Math.ceil(p.hp),
      boost: Math.round(p.boost),
      helmet: p.helmet,
      helmetDur: Math.round(p.helmetDur),
      vest: p.vest,
      vestDur: Math.round(p.vestDur),
      active: p.active,
      grenades: p.grenades,
      bandages: p.bandages,
      medkits: p.medkits,
      drinks: p.drinks,
      alive: this.aliveCount(),
      kills: p.kills,
      zoneState: zone.state,
      zoneTimer: Math.ceil(zone.timer),
      zonePhase: zone.phase,
      outside: zone.state !== 'idle' && p.mode === 'ground' && !zone.inside(p.pos.x, p.pos.z),
      prompt,
      action,
      actionProgress,
      scoped: this.ctl.scoped,
      canJump: this.plane.canJump,
      near,
    });
    if (changed) this.store.set({ slots });
    if (ammoChanged) this.store.set({ ammo: { ...p.ammo } });
    this.store.flush();
  }

  // -------------------------------------------------- UI driven actions

  setSensitivity(v: number): void {
    this.input.sensitivity = v;
  }
  uiPickup(id: number): void {
    const li = this.loot.items.find((l) => l.id === id);
    if (li && Math.hypot(li.x - this.player.pos.x, li.z - this.player.pos.z) < 3.2) this.ctl.pickup(li, true);
    this.hudT = 0;
  }
  uiDrop(slot: number): void {
    this.ctl.dropSlot(slot);
    this.hudT = 0;
  }
  uiSelect(slot: number): void {
    this.player.switchTo(slot);
  }
  uiUse(kind: 'bandage' | 'medkit' | 'drink'): void {
    this.player.startHeal(kind);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
