import type { Quality } from './config';

export type Phase = 'loading' | 'menu' | 'flight' | 'drop' | 'playing' | 'dead' | 'won';

export interface SlotInfo {
  id: string;
  name: string;
  ammo: number;
  mag: number;
  reserve: number;
  /** fire mode label for guns that can switch ('연사' / '단발'), '' otherwise */
  mode: string;
}
export interface FeedEntry {
  id: number;
  killer: string;
  victim: string;
  weapon: string;
  head: boolean;
  you: boolean;
  t: number;
}
export interface NearItem {
  id: number;
  label: string;
  rarity: number;
}
export interface MatchResult {
  placement: number;
  total: number;
  kills: number;
  damage: number;
  headshots: number;
  longest: number;
  time: number;
  killer: string;
  won: boolean;
}

export interface HudState {
  phase: Phase;
  progress: number;
  progressLabel: string;
  quality: Quality;
  paused: boolean;
  hp: number;
  boost: number;
  helmet: number;
  helmetDur: number;
  vest: number;
  vestDur: number;
  slots: (SlotInfo | null)[];
  active: number;
  grenades: number;
  bandages: number;
  medkits: number;
  drinks: number;
  ammo: Record<string, number>;
  alive: number;
  kills: number;
  zoneState: 'idle' | 'waiting' | 'shrinking' | 'final';
  zoneTimer: number;
  zonePhase: number;
  outside: boolean;
  prompt: string;
  action: string;
  actionProgress: number;
  feed: FeedEntry[];
  banner: string;
  bannerSub: string;
  bannerT: number;
  scoped: boolean;
  inventory: boolean;
  map: boolean;
  near: NearItem[];
  result: MatchResult | null;
  location: string;
  canJump: boolean;
  spectating: string;
  fps: number;
  autoPlay: boolean;
  autoRun: boolean;
}

type Listener = () => void;

/** Tiny external store the React HUD subscribes to. */
export class HudStore {
  state: HudState = {
    phase: 'loading', progress: 0, progressLabel: '', quality: 'high', paused: false,
    hp: 100, boost: 0, helmet: 0, helmetDur: 0, vest: 0, vestDur: 0,
    slots: [null, null, null], active: 0, grenades: 0, bandages: 0, medkits: 0, drinks: 0,
    ammo: { '9mm': 0, '5.56': 0, '7.62': 0, '12g': 0 },
    alive: 0, kills: 0, zoneState: 'idle', zoneTimer: 0, zonePhase: 0, outside: false,
    prompt: '', action: '', actionProgress: 0, feed: [], banner: '', bannerSub: '', bannerT: 0,
    scoped: false, inventory: false, map: false, near: [], result: null, location: '', canJump: false, spectating: '', fps: 0, autoPlay: false, autoRun: false,
  };
  private listeners = new Set<Listener>();
  private dirty = false;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): HudState => this.state;

  /** shallow-merge and mark for the next flush */
  set(patch: Partial<HudState>): void {
    let changed = false;
    const s = this.state as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      const v = (patch as Record<string, unknown>)[k];
      if (s[k] !== v) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const l of this.listeners) l();
  }
  /** immediate notify for rare, important transitions */
  emit(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.dirty = false;
    for (const l of this.listeners) l();
  }
}
