export type AmmoType = '9mm' | '5.56' | '7.62' | '12g';

export interface WeaponDef {
  id: string;
  name: string;
  kind: 'pistol' | 'smg' | 'ar' | 'shotgun' | 'dmr' | 'sniper';
  ammo: AmmoType;
  mag: number;
  damage: number;
  /** rounds per minute */
  rpm: number;
  auto: boolean;
  reload: number;
  /** hip-fire cone half angle in degrees */
  spread: number;
  adsSpread: number;
  /** degrees of muzzle climb per shot */
  recoil: number;
  pellets: number;
  /** damage starts dropping after this distance (m) and bottoms out at `falloffEnd` */
  falloffStart: number;
  falloffEnd: number;
  minDamage: number;
  /** optical zoom when aiming (1 = iron sights) */
  zoom: number;
  /** distance bots like to fight at */
  botRange: number;
  /** how far the report carries */
  loudness: number;
  headMul: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  viper: {
    id: 'viper', name: '바이퍼-9', kind: 'pistol', ammo: '9mm', mag: 15, damage: 22, rpm: 380, auto: false, reload: 1.5,
    spread: 1.5, adsSpread: 0.5, recoil: 1.5, pellets: 1, falloffStart: 18, falloffEnd: 60, minDamage: 0.5, zoom: 1.15, botRange: 14, loudness: 180, headMul: 2,
  },
  hornet: {
    id: 'hornet', name: '호넷 SMG', kind: 'smg', ammo: '9mm', mag: 32, damage: 19, rpm: 860, auto: true, reload: 2.0,
    spread: 1.7, adsSpread: 0.65, recoil: 0.62, pellets: 1, falloffStart: 22, falloffEnd: 75, minDamage: 0.5, zoom: 1.25, botRange: 18, loudness: 200, headMul: 1.9,
  },
  kestrel: {
    id: 'kestrel', name: '케스트럴 AR', kind: 'ar', ammo: '5.56', mag: 30, damage: 27, rpm: 690, auto: true, reload: 2.3,
    spread: 1.9, adsSpread: 0.3, recoil: 0.72, pellets: 1, falloffStart: 60, falloffEnd: 240, minDamage: 0.6, zoom: 1.5, botRange: 42, loudness: 260, headMul: 2.2,
  },
  bulwark: {
    id: 'bulwark', name: '불워크 AR', kind: 'ar', ammo: '7.62', mag: 30, damage: 34, rpm: 560, auto: true, reload: 2.7,
    spread: 2.2, adsSpread: 0.36, recoil: 1.05, pellets: 1, falloffStart: 55, falloffEnd: 220, minDamage: 0.6, zoom: 1.5, botRange: 40, loudness: 280, headMul: 2.2,
  },
  thunder: {
    id: 'thunder', name: '썬더-12', kind: 'shotgun', ammo: '12g', mag: 5, damage: 12, rpm: 75, auto: false, reload: 3.0,
    spread: 4.2, adsSpread: 3.4, recoil: 4.2, pellets: 9, falloffStart: 8, falloffEnd: 34, minDamage: 0.15, zoom: 1.1, botRange: 9, loudness: 260, headMul: 1.4,
  },
  ranger: {
    id: 'ranger', name: '레인저 DMR', kind: 'dmr', ammo: '7.62', mag: 10, damage: 48, rpm: 250, auto: false, reload: 2.6,
    spread: 2.6, adsSpread: 0.08, recoil: 1.9, pellets: 1, falloffStart: 120, falloffEnd: 420, minDamage: 0.7, zoom: 3.2, botRange: 75, loudness: 300, headMul: 2.3,
  },
  longbow: {
    id: 'longbow', name: '롱보우 SR', kind: 'sniper', ammo: '7.62', mag: 5, damage: 84, rpm: 40, auto: false, reload: 3.3,
    spread: 3.4, adsSpread: 0.02, recoil: 3.6, pellets: 1, falloffStart: 220, falloffEnd: 650, minDamage: 0.8, zoom: 5.5, botRange: 110, loudness: 340, headMul: 2.6,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

export type ItemKind = 'weapon' | 'ammo' | 'helmet' | 'vest' | 'bandage' | 'medkit' | 'drink' | 'grenade' | 'scope';

/** optics that mount on any long gun; the key is the magnification class */
export const SCOPES: Record<number, { label: string; short: string; zoom: number }> = {
  1: { label: '레드닷 사이트', short: '레드닷', zoom: 1.3 },
  2: { label: '2배율 스코프', short: '2배', zoom: 2 },
  4: { label: '4배율 스코프', short: '4배', zoom: 4 },
  8: { label: '8배율 스코프', short: '8배', zoom: 8 },
};
export const SCOPE_MAGS = [1, 2, 4, 8];

export function canMountScope(def: WeaponDef): boolean {
  return def.kind !== 'pistol';
}
/** ADS magnification of a weapon with whatever optic is on it */
export function weaponZoom(def: WeaponDef, scope = 0): number {
  return scope > 0 ? SCOPES[scope].zoom : def.zoom;
}

export interface Item {
  kind: ItemKind;
  /** weapon id / ammo type */
  sub?: string;
  /** stack count, armour level, or rounds left in a dropped weapon */
  n: number;
  /** remaining armour durability for dropped gear */
  dur?: number;
}

export const AMMO_STACK: Record<AmmoType, number> = { '9mm': 30, '5.56': 30, '7.62': 20, '12g': 8 };
export const AMMO_MAX: Record<AmmoType, number> = { '9mm': 210, '5.56': 240, '7.62': 180, '12g': 40 };
export const AMMO_LABEL: Record<AmmoType, string> = { '9mm': '9mm 탄', '5.56': '5.56mm 탄', '7.62': '7.62mm 탄', '12g': '12게이지 탄' };

export const ARMOR = [
  { reduce: 0, dur: 0 },
  { reduce: 0.3, dur: 80 },
  { reduce: 0.4, dur: 150 },
  { reduce: 0.55, dur: 230 },
];

export const HEAL = {
  bandage: { time: 3.2, amount: 16, cap: 75, max: 10, label: '붕대' },
  medkit: { time: 6.0, amount: 100, cap: 100, max: 4, label: '구급상자' },
  drink: { time: 3.6, amount: 0, cap: 100, max: 6, label: '에너지 드링크' },
} as const;

export function itemLabel(it: Item): string {
  switch (it.kind) {
    case 'weapon': return WEAPONS[it.sub!].name;
    case 'ammo': return `${AMMO_LABEL[it.sub as AmmoType]} ×${it.n}`;
    case 'helmet': return `헬멧 Lv.${it.n}`;
    case 'vest': return `방탄조끼 Lv.${it.n}`;
    case 'bandage': return `붕대 ×${it.n}`;
    case 'medkit': return '구급상자';
    case 'drink': return '에너지 드링크';
    case 'grenade': return '파편 수류탄';
    case 'scope': return SCOPES[it.n].label;
  }
}

/** 0 common .. 3 legendary; drives the pickup ring colour */
export function itemRarity(it: Item): number {
  switch (it.kind) {
    case 'weapon': {
      const k = WEAPONS[it.sub!].kind;
      return k === 'sniper' ? 3 : k === 'dmr' || k === 'ar' ? 2 : k === 'pistol' ? 0 : 1;
    }
    case 'helmet':
    case 'vest':
      return it.n;
    case 'medkit': return 2;
    case 'grenade': return 1;
    case 'scope': return it.n >= 8 ? 3 : it.n >= 4 ? 2 : 1;
    case 'drink': return 1;
    default: return 0;
  }
}
