import * as THREE from 'three';
import { mulberry32, rrange, type Rng } from '../core/math';
import { getModels } from '../entities/Models';
import type { LootSpot } from '../world/Structures';
import { AMMO_STACK, ARMOR, WEAPONS, itemRarity, type AmmoType, type Item } from './defs';

export interface LootItem {
  id: number;
  item: Item;
  x: number;
  y: number;
  z: number;
  building: number;
  upstairs: boolean;
  mesh: THREE.Mesh;
  alive: boolean;
  /** bot id that is currently walking to this item */
  claim: number;
  claimT: number;
}

const CELL = 16;
const MAX_RINGS = 1400;
const RARITY_COLORS = [new THREE.Color(0.75, 0.78, 0.8), new THREE.Color(0.25, 0.85, 0.4), new THREE.Color(0.25, 0.55, 1.0), new THREE.Color(1.0, 0.62, 0.12)];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function weighted<T>(rng: Rng, table: [T, number][]): T {
  let total = 0;
  for (const t of table) total += t[1];
  let r = rng() * total;
  for (const t of table) {
    r -= t[1];
    if (r <= 0) return t[0];
  }
  return table[0][0];
}

const WEAPON_TABLE: [string, number][][] = [
  [['viper', 30], ['hornet', 22], ['thunder', 18], ['kestrel', 14], ['bulwark', 10], ['ranger', 4], ['longbow', 2]],
  [['viper', 16], ['hornet', 20], ['thunder', 15], ['kestrel', 21], ['bulwark', 16], ['ranger', 8], ['longbow', 4]],
  [['viper', 6], ['hornet', 12], ['thunder', 10], ['kestrel', 24], ['bulwark', 22], ['ranger', 16], ['longbow', 10]],
];
const ARMOR_TABLE: [number, number][][] = [
  [[1, 70], [2, 25], [3, 5]],
  [[1, 48], [2, 38], [3, 14]],
  [[1, 22], [2, 46], [3, 32]],
];

export class Loot {
  group = new THREE.Group();
  items: LootItem[] = [];
  private grid = new Map<number, LootItem[]>();
  private nextId = 1;
  private rings: THREE.InstancedMesh;
  private ringsDirty = true;
  private visT = 0;
  private scratch: LootItem[] = [];

  constructor() {
    const ringGeo = new THREE.RingGeometry(0.21, 0.25, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 4;
    this.group.add(this.rings);
  }

  private key(x: number, z: number): number {
    return (Math.floor(x / CELL) + 512) * 2048 + (Math.floor(z / CELL) + 512);
  }

  clear(): void {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items.length = 0;
    this.grid.clear();
    this.ringsDirty = true;
  }

  /** scatter the starting loot over every spawn point of the map */
  populate(spots: LootSpot[], seed: number): void {
    const rng = mulberry32(seed);
    for (const s of spots) {
      const tier = Math.min(2, s.tier);
      const rolls = rng() < 0.42 ? 2 : 1;
      let k = 0;
      const put = (item: Item) => {
        const a = k * 2.4 + rng() * 0.6;
        const r = k === 0 ? 0 : 0.42 + k * 0.12;
        this.spawn(item, s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r, s.building, s.upstairs);
        k++;
      };
      for (let i = 0; i < rolls; i++) {
        const cat = weighted(rng, [['weapon', 30 + tier * 4], ['ammo', 20], ['armor', 15 + tier * 3], ['heal', 22], ['grenade', 6 + tier], ['none', 5 - tier]] as [string, number][]);
        if (cat === 'weapon') {
          const id = weighted(rng, WEAPON_TABLE[tier]);
          const def = WEAPONS[id];
          put({ kind: 'weapon', sub: id, n: def.mag });
          put({ kind: 'ammo', sub: def.ammo, n: AMMO_STACK[def.ammo] });
          if (rng() < 0.6) put({ kind: 'ammo', sub: def.ammo, n: AMMO_STACK[def.ammo] });
        } else if (cat === 'ammo') {
          const t = weighted(rng, [['9mm', 30], ['5.56', 28], ['7.62', 26], ['12g', 16]] as [AmmoType, number][]);
          put({ kind: 'ammo', sub: t, n: AMMO_STACK[t] });
        } else if (cat === 'armor') {
          const lvl = weighted(rng, ARMOR_TABLE[tier]);
          put({ kind: rng() < 0.5 ? 'helmet' : 'vest', n: lvl, dur: ARMOR[lvl].dur });
        } else if (cat === 'heal') {
          const h = weighted(rng, [['bandage', 50], ['medkit', 20 + tier * 6], ['drink', 30]] as [string, number][]);
          if (h === 'bandage') put({ kind: 'bandage', n: 3 + Math.floor(rng() * 3) });
          else put({ kind: h as 'medkit' | 'drink', n: 1 });
        } else if (cat === 'grenade') {
          put({ kind: 'grenade', n: 1 });
        }
      }
    }
  }

  spawn(item: Item, x: number, y: number, z: number, building = -1, upstairs = false): LootItem {
    const lib = getModels();
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material = lib.gearMat;
    let rx = 0;
    let rz = 0;
    let yOff = 0;
    let scale = 1;
    switch (item.kind) {
      case 'weapon':
        geo = lib.weapons[item.sub!].geo;
        mat = lib.weaponMat;
        rz = Math.PI / 2;
        yOff = 0.035;
        break;
      case 'ammo':
        geo = lib.ammo[item.sub!];
        break;
      case 'helmet':
        geo = lib.helmet[item.n];
        yOff = -0.02;
        scale = 1.15;
        break;
      case 'vest':
        geo = lib.vest[item.n];
        rx = -Math.PI / 2;
        yOff = 0.16;
        break;
      case 'bandage':
        geo = lib.bandage;
        scale = 1.2;
        break;
      case 'medkit':
        geo = lib.medkit;
        break;
      case 'drink':
        geo = lib.drink;
        scale = 1.3;
        break;
      default:
        geo = lib.grenade;
        yOff = 0.06;
        scale = 1.4;
    }
    const mesh = new THREE.Mesh(geo, mat);
    _e.set(rx, Math.random() * Math.PI * 2, rz, 'YXZ');
    _q.setFromEuler(_e);
    mesh.matrix.compose(_p.set(x, y + yOff, z), _q, _s.set(scale, scale, scale));
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    mesh.castShadow = false;
    mesh.visible = false;
    const li: LootItem = { id: this.nextId++, item, x, y, z, building, upstairs, mesh, alive: true, claim: -1, claimT: 0 };
    this.items.push(li);
    const k = this.key(x, z);
    const arr = this.grid.get(k);
    if (arr) arr.push(li);
    else this.grid.set(k, [li]);
    this.group.add(mesh);
    this.ringsDirty = true;
    this.visT = 0;
    return li;
  }

  remove(li: LootItem): void {
    if (!li.alive) return;
    li.alive = false;
    this.group.remove(li.mesh);
    const arr = this.grid.get(this.key(li.x, li.z));
    if (arr) {
      const i = arr.indexOf(li);
      if (i >= 0) arr.splice(i, 1);
    }
    const i = this.items.indexOf(li);
    if (i >= 0) this.items.splice(i, 1);
    this.ringsDirty = true;
  }

  /** drop a pile of items around a point (death loot, swapped gear) */
  scatter(items: Item[], x: number, y: number, z: number, building: number, upstairs: boolean, rng: Rng = Math.random): void {
    items.forEach((it, i) => {
      const a = i * 2.39996 + rng() * 0.4;
      const r = items.length === 1 ? rrange(rng, 0.3, 0.6) : 0.35 + Math.sqrt(i) * 0.3;
      this.spawn(it, x + Math.cos(a) * r, y + 0.03, z + Math.sin(a) * r, building, upstairs);
    });
  }

  query(x: number, z: number, radius: number, out: LootItem[] = this.scratch): LootItem[] {
    out.length = 0;
    const i0 = Math.floor((x - radius) / CELL);
    const i1 = Math.floor((x + radius) / CELL);
    const j0 = Math.floor((z - radius) / CELL);
    const j1 = Math.floor((z + radius) / CELL);
    const r2 = radius * radius;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.grid.get((i + 512) * 2048 + (j + 512));
        if (!arr) continue;
        for (const li of arr) {
          const dx = li.x - x;
          const dz = li.z - z;
          if (dx * dx + dz * dz <= r2) out.push(li);
        }
      }
    }
    return out;
  }

  update(dt: number, cam: THREE.Vector3, range = 85): void {
    this.visT -= dt;
    if (this.visT <= 0) {
      this.visT = 0.35;
      const r2 = range * range;
      for (const li of this.items) {
        const dx = li.x - cam.x;
        const dz = li.z - cam.z;
        li.mesh.visible = dx * dx + dz * dz < r2;
      }
    }
    if (this.ringsDirty) {
      this.ringsDirty = false;
      const n = Math.min(MAX_RINGS, this.items.length);
      for (let i = 0; i < n; i++) {
        const li = this.items[i];
        const rar = itemRarity(li.item);
        const sc = li.item.kind === 'weapon' ? 1.5 : 0.9;
        _m.compose(_p.set(li.x, li.y + 0.02, li.z), _q.identity(), _s.set(sc, 1, sc));
        this.rings.setMatrixAt(i, _m);
        this.rings.setColorAt(i, RARITY_COLORS[rar]);
      }
      this.rings.count = n;
      this.rings.instanceMatrix.needsUpdate = true;
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    }
  }
}
