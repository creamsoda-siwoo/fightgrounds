import * as THREE from 'three';
import { ISLAND_RADIUS, WORLD_HALF, WORLD_SIZE, type QualityPreset } from '../config';
import { GeoBuilder } from '../core/GeoBuilder';
import { Noise2D, clamp, lerp, mulberry32, rpick, rrange, type Rng } from '../core/math';
import { createTextures, type TextureSet } from '../core/textures';
import { ColliderWorld, SURF_DIRT, SURF_WATER, SURF_WOOD, type RayHit } from './Colliders';
import { Environment } from './Environment';
import {
  BUILDERS, BUILDING_DIMS, barrel, barrier, begin, car, container, crate, end, fence, hayBale, lampPost, lighthouse,
  logPile, makeCtx, powerPole, radioMast, sandbags, tent, tires, watchTower, well,
  type BuildingInfo, type Ctx, type LootSpot,
} from './Structures';
import { Terrain, rawTerrainHeight, type RoadDef, type SiteDef } from './Terrain';
import { Vegetation } from './Vegetation';

export interface WorldHit extends RayHit {
  x: number;
  y: number;
  z: number;
}

const SITES: Omit<SiteDef, 'baseY'>[] = [
  { id: 'central', name: '하벤 시가지', x: 15, z: -20, radius: 98, yaw: 0.22, kind: 'town' },
  { id: 'harbor', name: '마렌 항구', x: -335, z: 170, radius: 74, yaw: -0.5, kind: 'harbor' },
  { id: 'oak', name: '참나무골', x: -170, z: -255, radius: 62, yaw: 0.9, kind: 'village' },
  { id: 'ridge', name: '능선 초소', x: 265, z: -250, radius: 54, yaw: -0.3, kind: 'outpost' },
  { id: 'farm', name: '소금늪 농장', x: 305, z: 115, radius: 60, yaw: 0.4, kind: 'farm' },
  { id: 'depot', name: '철곡 창고지', x: 115, z: 300, radius: 68, yaw: 1.1, kind: 'depot' },
  { id: 'cabins', name: '솔마루 산장', x: -255, z: -40, radius: 48, yaw: 0.1, kind: 'cabins' },
  { id: 'light', name: '등대곶', x: -90, z: 418, radius: 38, yaw: 0.7, kind: 'lighthouse' },
  { id: 'wind', name: '바람골', x: 395, z: -70, radius: 52, yaw: 1.35, kind: 'village' },
  { id: 'lumber', name: '북녘 벌목장', x: 45, z: -395, radius: 48, yaw: -0.2, kind: 'lumber' },
];

const LINKS: [string, string][] = [
  ['central', 'oak'], ['central', 'farm'], ['central', 'depot'], ['central', 'cabins'], ['cabins', 'harbor'],
  ['harbor', 'depot'], ['oak', 'lumber'], ['lumber', 'ridge'], ['ridge', 'wind'], ['wind', 'farm'], ['depot', 'light'],
  ['oak', 'cabins'], ['central', 'ridge'],
];

class Occupancy {
  private cells = new Map<number, { x: number; z: number; r: number }[]>();
  private key(i: number, j: number): number {
    return (i + 512) * 4096 + (j + 512);
  }
  add(x: number, z: number, r: number): void {
    const i0 = Math.floor((x - r) / 16);
    const i1 = Math.floor((x + r) / 16);
    const j0 = Math.floor((z - r) / 16);
    const j1 = Math.floor((z + r) / 16);
    const item = { x, z, r };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = this.key(i, j);
      const arr = this.cells.get(k);
      if (arr) arr.push(item);
      else this.cells.set(k, [item]);
    }
  }
  test(x: number, z: number, r: number): boolean {
    const i0 = Math.floor((x - r) / 16);
    const i1 = Math.floor((x + r) / 16);
    const j0 = Math.floor((z - r) / 16);
    const j1 = Math.floor((z + r) / 16);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const arr = this.cells.get(this.key(i, j));
      if (!arr) continue;
      for (const it of arr) {
        const rr = it.r + r;
        if ((it.x - x) * (it.x - x) + (it.z - z) * (it.z - z) < rr * rr) return true;
      }
    }
    return false;
  }
}

function buildMaterials(tex: TextureSet): Record<string, THREE.Material> {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const m: Record<string, THREE.Material> = {
    plaster: std({ map: tex.plaster, normalMap: tex.plasterN, roughness: 0.93 }),
    brick: std({ map: tex.brick, normalMap: tex.brickN, roughness: 0.9 }),
    concrete: std({ map: tex.concrete, normalMap: tex.concreteN, roughness: 0.88 }),
    wood: std({ map: tex.wood, normalMap: tex.woodN, roughness: 0.82 }),
    roof: std({ map: tex.roof, normalMap: tex.roofN, roughness: 0.8 }),
    metal: std({ map: tex.metal, normalMap: tex.metalN, roughness: 0.5, metalness: 0.55 }),
    trim: std({ roughness: 0.6, metalness: 0.15 }),
    paint: std({ roughness: 0.42, metalness: 0.45 }),
    cloth: std({ roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x86aabb, transparent: true, opacity: 0.34, roughness: 0.04, metalness: 0.1, envMapIntensity: 2.6, depthWrite: false,
    }),
    emissive: std({ emissive: 0xffe9b0, emissiveIntensity: 2.6, roughness: 0.5 }),
  };
  (m.plaster as THREE.MeshStandardMaterial).normalScale.set(0.5, 0.5);
  (m.brick as THREE.MeshStandardMaterial).normalScale.set(1.2, 1.2);
  (m.roof as THREE.MeshStandardMaterial).normalScale.set(1.3, 1.3);
  return m;
}

export class World {
  noise: Noise2D;
  terrain!: Terrain;
  colliders = new ColliderWorld();
  env!: Environment;
  vegetation!: Vegetation;
  sites: SiteDef[] = [];
  roads: RoadDef[] = [];
  buildings: BuildingInfo[] = [];
  lootSpots: LootSpot[] = [];
  group = new THREE.Group();
  textures!: TextureSet;
  materials!: Record<string, THREE.Material>;
  private occ = new Occupancy();
  private hitTmp: RayHit = { t: 0, nx: 0, ny: 1, nz: 0, surf: 0 };

  constructor(private seed = 20260) {
    this.noise = new Noise2D(seed);
  }

  /** Generates everything. `progress` lets the UI show a loading bar between steps. */
  async generate(scene: THREE.Scene, renderer: THREE.WebGLRenderer, q: QualityPreset, progress: (p: number, label: string) => Promise<void>): Promise<void> {
    await progress(0.05, '텍스처 합성 중');
    this.textures = createTextures(q.textureSize);
    for (const t of Object.values(this.textures)) (t as THREE.Texture).anisotropy = q.aniso;
    this.materials = buildMaterials(this.textures);

    await progress(0.18, '섬 지형 생성 중');
    this.sites = SITES.map((s) => ({ ...s, baseY: 0 }));
    const rng = mulberry32(this.seed * 7 + 3);
    this.snapToCoast(this.site('harbor'), 0.5);
    this.snapToCoast(this.site('light'), 0.35);
    this.layoutRoads(rng);
    this.terrain = new Terrain(this.noise, this.sites, this.roads);

    await progress(0.36, '마을과 구조물 건설 중');
    for (const s of this.sites) this.buildSite(s, rng);
    this.buildWild(rng);

    await progress(0.56, '지형 메시 구축 중');
    this.group.add(this.terrain.build(this.textures, q.aniso));

    await progress(0.68, '숲과 초목 배치 중');
    this.vegetation = new Vegetation(this.terrain, this.colliders, this.noise, this.textures, q, (x, z, r) => this.occ.test(x, z, r));
    this.group.add(this.vegetation.group);
    this.colliders.finalize();

    await progress(0.85, '대기와 바다 렌더링 준비 중');
    this.env = new Environment(scene, renderer, q, this.textures, this.terrain.heightTex);
    scene.add(this.group);
  }

  private site(id: string): SiteDef {
    return this.sites.find((s) => s.id === id)!;
  }

  /** slide a settlement along its bearing until it sits on the shoreline */
  private snapToCoast(s: SiteDef, inland: number): void {
    const len = Math.hypot(s.x, s.z);
    const dx = s.x / len;
    const dz = s.z / len;
    let shore = len;
    for (let r = 180; r < ISLAND_RADIUS + 120; r += 4) {
      if (rawTerrainHeight(this.noise, dx * r, dz * r) < 0.5 && rawTerrainHeight(this.noise, dx * (r + 8), dz * (r + 8)) < 0.5) {
        shore = r;
        break;
      }
    }
    const r = shore - s.radius * inland;
    s.x = dx * r;
    s.z = dz * r;
  }

  private layoutRoads(rng: Rng): void {
    for (const s of this.sites) {
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const L = s.radius * 0.96;
      // local X street
      this.roads.push({ pts: [[s.x - c * L, s.z + sn * L], [s.x + c * L, s.z - sn * L]], width: 6.5 });
      if (s.kind === 'town' || s.kind === 'depot') {
        const L2 = s.radius * 0.9;
        this.roads.push({ pts: [[s.x - sn * L2, s.z - c * L2], [s.x + sn * L2, s.z + c * L2]], width: 6 });
      }
    }
    for (const [a, b] of LINKS) {
      const A = this.site(a);
      const B = this.site(b);
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const amp = len * rrange(rng, -0.12, 0.12);
      const amp2 = len * rrange(rng, -0.05, 0.05);
      const n = Math.ceil(len / 10);
      const pts: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const off = Math.sin(t * Math.PI) * amp + Math.sin(t * Math.PI * 2) * amp2;
        pts.push([A.x + dx * t + nx * off, A.z + dz * t + nz * off]);
      }
      this.roads.push({ pts, width: 5 });
    }
  }

  private meshesFrom(gb: GeoBuilder): void {
    const geos = gb.build();
    for (const key of Object.keys(geos)) {
      const mesh = new THREE.Mesh(geos[key], this.materials[key] ?? this.materials.trim);
      mesh.castShadow = key !== 'glass' && key !== 'emissive';
      mesh.receiveShadow = key !== 'glass';
      mesh.matrixAutoUpdate = false;
      if (key === 'glass') mesh.renderOrder = 3;
      this.group.add(mesh);
    }
  }

  private buildSite(s: SiteDef, rng: Rng): void {
    const gb = new GeoBuilder();
    const ctx = makeCtx(gb, this.colliders, rng, this.buildings, this.lootSpots);
    ctx.tier = s.kind === 'outpost' ? 2 : s.kind === 'depot' || s.kind === 'town' || s.kind === 'harbor' ? 1 : 0;
    const cs = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const W = (lx: number, lz: number): [number, number] => [s.x + lx * cs + lz * sn, s.z - lx * sn + lz * cs];
    const y = s.baseY;

    const place = (kind: string, lx: number, lz: number, lyaw: number): boolean => {
      const [w, d] = BUILDING_DIMS[kind];
      const r = Math.hypot(w, d) / 2;
      if (Math.hypot(lx, lz) + r > s.radius * 0.99) return false;
      const [wx, wz] = W(lx, lz);
      if (this.occ.test(wx, wz, r + 1.2)) return false;
      BUILDERS[kind](ctx, wx, y, wz, s.yaw + lyaw);
      this.occ.add(wx, wz, r + 0.6);
      this.terrain.paintGround(wx, wz, r + 2.5, 0.85);
      return true;
    };
    const prop = (lx: number, lz: number, r: number, fn: (wx: number, wz: number) => void, force = false): boolean => {
      if (Math.hypot(lx, lz) + r > s.radius) return false;
      const [wx, wz] = W(lx, lz);
      if (!force && this.occ.test(wx, wz, r)) return false;
      fn(wx, wz);
      this.occ.add(wx, wz, r);
      return true;
    };
    const outdoorLoot = (lx: number, lz: number, bonus = 0) => {
      const [wx, wz] = W(lx, lz);
      this.lootSpots.push({ x: wx, y: y + 0.03, z: wz, building: -1, upstairs: false, tier: ctx.tier + bonus });
    };
    /** line of buildings facing the X street (side = +1 / -1) */
    const rowX = (side: number, from: number, to: number, kinds: string[], setback = 5.2) => {
      let x = from;
      let guard = 0;
      while (x < to && guard++ < 30) {
        const kind = rpick(rng, kinds);
        const [w, d] = BUILDING_DIMS[kind];
        if (x + w > to) {
          x += 3;
          continue;
        }
        place(kind, x + w / 2, side * (setback + d / 2 + rrange(rng, 0, 1.6)), (side > 0 ? Math.PI : 0) + rrange(rng, -0.04, 0.04));
        x += w + rrange(rng, 2.6, 6.5);
      }
    };
    const rowZ = (side: number, from: number, to: number, kinds: string[], setback = 5.0) => {
      let z = from;
      let guard = 0;
      while (z < to && guard++ < 30) {
        const kind = rpick(rng, kinds);
        const [w, d] = BUILDING_DIMS[kind];
        if (z + w > to) {
          z += 3;
          continue;
        }
        place(kind, side * (setback + d / 2 + rrange(rng, 0, 1.6)), z + w / 2, (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rrange(rng, -0.04, 0.04));
        z += w + rrange(rng, 2.6, 6.5);
      }
    };
    const streetFurniture = (len: number, cross: boolean) => {
      for (let lx = -len; lx <= len; lx += 26) {
        const side = Math.round(lx / 26) % 2 === 0 ? 1 : -1;
        prop(lx, side * 4.0, 0.3, (wx, wz) => lampPost(ctx, wx, y, wz, s.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2)), true);
      }
      if (cross) {
        for (let lz = -len + 13; lz <= len; lz += 26) {
          if (Math.abs(lz) < 8) continue;
          prop(4.0, lz, 0.3, (wx, wz) => lampPost(ctx, wx, y, wz, s.yaw + Math.PI), true);
        }
      }
      const cars = Math.round(len / 22);
      const paints = [0x8a2f25, 0x2f4f6f, 0x6f7a80, 0xc9c4b4, 0x3d5a3a, 0x9a7a2e, 0x2a2c30];
      for (let k = 0; k < cars; k++) {
        const lx = rrange(rng, -len, len);
        const side = rng() < 0.5 ? 1 : -1;
        if (prop(lx, side * 2.1, 2.3, (wx, wz) => car(ctx, wx, y, wz, s.yaw + (rng() < 0.5 ? 0 : Math.PI) + rrange(rng, -0.12, 0.12), rpick(rng, paints), rng() < 0.35))) {
          if (rng() < 0.5) outdoorLoot(lx + 2.9, side * 2.1);
        }
      }
    };
    const scatter = (count: number, minR: number, maxR: number, r: number, fn: (wx: number, wz: number, lx: number, lz: number) => void) => {
      for (let k = 0; k < count; k++) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const a = rng() * Math.PI * 2;
          const rad = rrange(rng, minR, maxR);
          const lx = Math.cos(a) * rad;
          const lz = Math.sin(a) * rad;
          if (Math.abs(lz) < 4.8 + r) continue;
          const [tx, tz] = W(lx, lz);
          if (this.terrain.splatAt(tx, tz, 0) > 0.3) continue;
          if (prop(lx, lz, r, (wx, wz) => fn(wx, wz, lx, lz))) break;
        }
      }
    };
    const clutter = (n: number) => {
      scatter(n, 6, s.radius * 0.92, 1.1, (wx, wz, lx, lz) => {
        const roll = rng();
        if (roll < 0.34) {
          crate(ctx, wx, y, wz, rng() * 3, rrange(rng, 0.8, 1.15));
          if (rng() < 0.4) crate(ctx, wx + 1.05, y, wz + 0.2, rng() * 3, 0.8);
        } else if (roll < 0.6) {
          barrel(ctx, wx, y, wz, rpick(rng, [0x3e6a8c, 0x8a3a2e, 0x4a7a4a, 0x8a8a3a]));
          if (rng() < 0.5) barrel(ctx, wx + 0.66, y, wz + 0.1, 0x55626c);
        } else if (roll < 0.8) tires(ctx, wx, y, wz, 2 + Math.floor(rng() * 3));
        else fence(ctx, wx, y, wz, rng() * 3.14, rrange(rng, 3.5, 6.5));
        if (rng() < 0.3) outdoorLoot(lx + 1.3, lz - 0.9);
      });
    };

    const R = s.radius;
    switch (s.kind) {
      case 'town': {
        const k1 = ['house2', 'house2', 'house', 'house', 'shop', 'shop'];
        for (const side of [1, -1]) {
          rowX(side, -R * 0.9, -9, k1);
          rowX(side, 9, R * 0.9, k1);
          rowZ(side, -R * 0.85, -16, k1);
          rowZ(side, 16, R * 0.85, k1);
        }
        // back lots
        for (const side of [1, -1]) {
          rowX(side, -R * 0.75, -30, ['house', 'house2', 'warehouse', 'shack'], 24);
          rowX(side, 30, R * 0.75, ['house', 'house2', 'warehouse', 'shack'], 24);
        }
        streetFurniture(R * 0.85, true);
        prop(11, 11, 1.4, (wx, wz) => well(ctx, wx, y, wz));
        clutter(26);
        for (let k = 0; k < 6; k++) scatter(1, 10, R * 0.8, 1.6, (wx, wz) => barrier(ctx, wx, y, wz, rng() * 3.14));
        break;
      }
      case 'village': {
        const k1 = ['house', 'house', 'house2', 'house', 'shack', 'shop'];
        for (const side of [1, -1]) rowX(side, -R * 0.88, R * 0.88, k1);
        streetFurniture(R * 0.8, false);
        prop(0, 12, 1.4, (wx, wz) => well(ctx, wx, y, wz));
        clutter(12);
        scatter(5, 14, R * 0.9, 1.6, (wx, wz) => hayBale(ctx, wx, y, wz, rng() * 3.14));
        break;
      }
      case 'harbor': {
        rowX(1, -R * 0.85, R * 0.85, ['warehouse', 'warehouse', 'shop', 'house']);
        rowX(-1, -R * 0.85, -R * 0.3, ['shop', 'shack', 'house']);
        // container yard on the sea side
        const cols = [0x9a3a2a, 0x2a5a8a, 0x3a7a5a, 0xc9a02a, 0x6a6f76, 0xa85a22];
        for (let gx = -R * 0.2; gx < R * 0.75; gx += 7.4) {
          for (let gz = -9; gz > -R * 0.7; gz -= 3.6) {
            if (rng() < 0.3) continue;
            const open = rng() < 0.25;
            prop(gx + 3, gz, 2.6, (wx, wz) => {
              container(ctx, wx, y, wz, s.yaw, rpick(rng, cols), open);
              if (!open && rng() < 0.4) container(ctx, wx, y + 2.6, wz, s.yaw, rpick(rng, cols), false);
            });
          }
        }
        streetFurniture(R * 0.8, false);
        clutter(16);
        for (let k = 0; k < 5; k++) scatter(1, 10, R * 0.85, 1.6, (wx, wz) => barrier(ctx, wx, y, wz, s.yaw + rrange(rng, -0.2, 0.2)));
        this.buildPier(ctx, s, rng);
        break;
      }
      case 'farm': {
        place('house2', -14, 12, Math.PI);
        place('warehouse', 16, 14, Math.PI);
        place('house', -32, -11, 0);
        place('shack', 6, -9, 0);
        place('shack', 34, -9, 0);
        prop(-2, 13, 1.4, (wx, wz) => well(ctx, wx, y, wz));
        // hay field
        for (let gx = -8; gx <= 30; gx += 6.5) for (let gz = -22; gz >= -44; gz -= 7) {
          if (rng() < 0.75) prop(gx + rrange(rng, -1, 1), gz + rrange(rng, -1, 1), 1.3, (wx, wz) => hayBale(ctx, wx, y, wz, s.yaw + rrange(rng, -0.3, 0.3)));
        }
        // paddock fences
        for (let k = 0; k < 7; k++) {
          prop(-44 + k * 6, 32, 0.4, (wx, wz) => fence(ctx, wx, y, wz, s.yaw, 6), true);
          prop(-44 + k * 6, 46, 0.4, (wx, wz) => fence(ctx, wx, y, wz, s.yaw, 6), true);
        }
        prop(8, -3.2, 2.4, (wx, wz) => car(ctx, wx, y, wz, s.yaw + 0.1, 0x4a6a3a, true));
        streetFurniture(R * 0.7, false);
        clutter(12);
        outdoorLoot(12, -30);
        outdoorLoot(-30, 38);
        break;
      }
      case 'outpost': {
        ctx.tier = 2;
        place('bunker', -16, 13, Math.PI);
        place('bunker', 12, 13, Math.PI);
        place('bunker', -4, -14, 0);
        place('warehouse', 28, -18, 0);
        const tents: [number, number, number][] = [[-30, -10, 0], [-30, -17, 0], [-34, 14, 0.2], [30, 12, Math.PI]];
        for (const [lx, lz, rot] of tents) prop(lx, lz, 3.2, (wx, wz) => tent(ctx, wx, y, wz, s.yaw + rot));
        prop(-R * 0.72, -R * 0.4, 2.2, (wx, wz) => watchTower(ctx, wx, y, wz, s.yaw));
        prop(R * 0.7, R * 0.35, 2.2, (wx, wz) => watchTower(ctx, wx, y, wz, s.yaw + 1));
        // perimeter sandbags and barriers
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2 + 0.2;
          const rad = R * 0.88;
          if (Math.abs(Math.sin(a) * rad) < 7) continue;
          prop(Math.cos(a) * rad, Math.sin(a) * rad, 1.7, (wx, wz) => {
            if (k % 3 === 0) barrier(ctx, wx, y, wz, s.yaw - a + Math.PI / 2);
            else sandbags(ctx, wx, y, wz, s.yaw - a + Math.PI / 2, 3.2, 3);
          });
        }
        prop(4, -3.0, 2.4, (wx, wz) => car(ctx, wx, y, wz, s.yaw, 0x4a5440, true));
        prop(-12, 3.0, 2.4, (wx, wz) => car(ctx, wx, y, wz, s.yaw + Math.PI, 0x4a5440, true));
        prop(14, -9, 2.8, (wx, wz) => container(ctx, wx, y, wz, s.yaw + 0.2, 0x56603f, true));
        clutter(12);
        for (let k = 0; k < 5; k++) outdoorLoot(rrange(rng, -28, 28), rrange(rng, 6, 9) * (rng() < 0.5 ? -1 : 1), 0);
        break;
      }
      case 'depot': {
        for (const side of [1, -1]) {
          rowX(side, -R * 0.85, -8, ['warehouse', 'shop', 'warehouse']);
          rowX(side, 8, R * 0.85, ['warehouse', 'warehouse', 'shack']);
        }
        const cols = [0x9a3a2a, 0x2a5a8a, 0x3a7a5a, 0xc9a02a, 0x6a6f76];
        scatter(10, 12, R * 0.9, 3.4, (wx, wz) => {
          const open = rng() < 0.3;
          const rot = s.yaw + (rng() < 0.5 ? 0 : Math.PI / 2);
          container(ctx, wx, y, wz, rot, rpick(rng, cols), open);
        });
        streetFurniture(R * 0.8, true);
        clutter(22);
        for (let k = 0; k < 6; k++) scatter(1, 10, R * 0.85, 1.6, (wx, wz) => barrier(ctx, wx, y, wz, s.yaw + rrange(rng, -0.2, 0.2)));
        break;
      }
      case 'cabins': {
        for (const side of [1, -1]) rowX(side, -R * 0.85, R * 0.85, ['shack', 'house', 'shack', 'shack'], 6);
        prop(0, 14, 1.4, (wx, wz) => well(ctx, wx, y, wz));
        scatter(4, 8, R * 0.9, 2.2, (wx, wz) => logPile(ctx, wx, y, wz, rng() * 3.14));
        clutter(9);
        break;
      }
      case 'lumber': {
        place('warehouse', -12, 15, Math.PI);
        place('shack', 14, 9, Math.PI);
        place('shack', 24, 10, Math.PI);
        place('house', 10, -11, 0);
        place('shack', -18, -9, 0);
        scatter(9, 8, R * 0.92, 2.3, (wx, wz) => logPile(ctx, wx, y, wz, s.yaw + rrange(rng, -0.4, 0.4)));
        prop(-4, -3, 2.4, (wx, wz) => car(ctx, wx, y, wz, s.yaw + 0.05, 0x8a5a2a, true));
        clutter(10);
        outdoorLoot(-26, 4);
        outdoorLoot(30, -14);
        break;
      }
      case 'lighthouse': {
        prop(0, 16, 5.5, (wx, wz) => lighthouse(ctx, wx, y, wz));
        place('house', -14, -10, 0);
        place('shack', 12, -8, 0);
        clutter(6);
        break;
      }
    }
    this.meshesFrom(gb);
  }

  private buildPier(ctx: Ctx, s: SiteDef, rng: Rng): void {
    // head for the nearest open water
    let best = 0;
    let bestH = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const h = this.terrain.heightAt(s.x + Math.cos(a) * (s.radius + 45), s.z + Math.sin(a) * (s.radius + 45));
      if (h < bestH) {
        bestH = h;
        best = a;
      }
    }
    if (bestH > -0.5) return;
    const dx = Math.cos(best);
    const dz = Math.sin(best);
    const yaw = Math.atan2(-dz, dx); // local +X along the pier
    const deck = Math.max(1.3, s.baseY - 0.9);
    // start where the shore drops below the deck
    let start = s.radius * 0.7;
    for (let d = s.radius * 0.6; d < s.radius + 80; d += 2) {
      if (this.terrain.heightAt(s.x + dx * d, s.z + dz * d) < deck - 0.3) {
        start = d - 5;
        break;
      }
    }
    const len = 54;
    const cx = s.x + dx * (start + len / 2);
    const cz = s.z + dz * (start + len / 2);
    begin(ctx, cx, 0, cz, yaw);
    const gb = ctx.gb;
    gb.box('wood', 0, deck - 0.1, 0, len, 0.2, 3.4, 0x9a7f5c, { uv: 0.6 });
    for (let k = 0; k <= 15; k++) {
      const lx = -len / 2 + (k * len) / 15;
      for (const sz of [-1.5, 1.5]) gb.cyl('wood', lx, deck - 3.2, sz, 0.16, 0.18, 7.2, 0x5a4634, 7);
      gb.box('wood', lx, deck - 0.3, 0, 0.2, 0.2, 3.5, 0x6a533c, { uv: 0.6 });
      if (k % 3 === 0) for (const sz of [-1.6, 1.6]) gb.cyl('wood', lx, deck + 0.4, sz, 0.11, 0.12, 0.8, 0x5a4634, 7);
    }
    const [wx, wz] = [cx, cz];
    this.colliders.addBox(wx, wz, len / 2, 1.7, yaw, deck - 0.5, deck, SURF_WOOD);
    // ramp from the shore up to the deck
    const rampX = s.x + dx * (start - 5);
    const rampZ = s.z + dz * (start - 5);
    this.colliders.addBox(rampX, rampZ, 5, 1.7, yaw, deck - 6, Math.min(deck, s.baseY) - 0.6, SURF_WOOD, deck);
    gb.box('wood', -len / 2 - 5, (deck + s.baseY) / 2 - 0.1, 0, 10.2, 0.2, 3.4, 0x9a7f5c, { uv: 0.6, rz: Math.atan2(deck - s.baseY, 10) });
    crate(ctx, len / 2 - 2, deck, 0.8, 0.3, 0.9);
    crate(ctx, len / 2 - 6, deck, -0.9, 0.9, 0.8);
    barrel(ctx, len / 2 - 3.4, deck, -1.0, 0x8a3a2e);
    for (const lx of [len / 2 - 4, 8, -12]) {
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      this.lootSpots.push({ x: cx + lx * cs, y: deck + 0.03, z: cz - lx * sn, building: -1, upstairs: false, tier: 2 });
    }
    end(ctx);
    void rng;
  }

  private buildWild(rng: Rng): void {
    const gb = new GeoBuilder();
    const ctx = makeCtx(gb, this.colliders, rng, this.buildings, this.lootSpots);
    ctx.tier = 0;
    const inSite = (x: number, z: number, pad: number) => this.sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.radius + pad);
    // wrecks and poles along the connecting roads
    const paints = [0x8a2f25, 0x2f4f6f, 0x6f7a80, 0xc9c4b4, 0x3d5a3a, 0x9a7a2e];
    for (const road of this.roads) {
      if (road.pts.length < 4) continue;
      let acc = rrange(rng, 20, 70);
      let poleAcc = 0;
      for (let k = 0; k < road.pts.length - 1; k++) {
        const [ax, az] = road.pts[k];
        const [bx, bz] = road.pts[k + 1];
        const seg = Math.hypot(bx - ax, bz - az);
        const yaw = Math.atan2(-(bz - az), bx - ax);
        const nx = -(bz - az) / seg;
        const nz = (bx - ax) / seg;
        acc -= seg;
        poleAcc += seg;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        if (inSite(mx, mz, 6)) continue;
        const h = this.terrain.heightAt(mx, mz);
        if (h < 1.3) continue;
        if (poleAcc > 38) {
          poleAcc = 0;
          const px = mx + nx * 5.2;
          const pz = mz + nz * 5.2;
          const ph = this.terrain.heightAt(px, pz);
          if (ph > 1.5 && !this.occ.test(px, pz, 0.5)) {
            powerPole(ctx, px, ph - 0.3, pz, yaw);
            this.occ.add(px, pz, 0.5);
          }
        }
        if (acc < 0) {
          acc = rrange(rng, 90, 190);
          const side = rng() < 0.5 ? 1 : -1;
          const cx = mx + nx * side * 1.6;
          const cz = mz + nz * side * 1.6;
          if (this.terrain.flatness(cx, cz) > 0.985 && !this.occ.test(cx, cz, 2.6)) {
            car(ctx, cx, this.terrain.heightAt(cx, cz) - 0.06, cz, yaw + rrange(rng, -0.5, 0.5), rpick(rng, paints), rng() < 0.4);
            this.occ.add(cx, cz, 2.6);
            const lx = cx + nx * side * 2.4;
            const lz = cz + nz * side * 2.4;
            this.lootSpots.push({ x: lx, y: this.terrain.heightAt(lx, lz) + 0.04, z: lz, building: -1, upstairs: false, tier: 0 });
            if (rng() < 0.5) {
              const bx2 = cx + Math.cos(yaw) * 4.5;
              const bz2 = cz - Math.sin(yaw) * 4.5;
              if (!this.occ.test(bx2, bz2, 1.5)) {
                barrier(ctx, bx2, this.terrain.heightAt(bx2, bz2) - 0.05, bz2, yaw + Math.PI / 2 + rrange(rng, -0.3, 0.3));
                this.occ.add(bx2, bz2, 1.5);
              }
            }
          }
        }
      }
    }
    // lonely shacks, camps and crate drops in the wilderness
    let shacks = 0;
    for (let attempt = 0; attempt < 900 && shacks < 16; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * ISLAND_RADIUS * 0.92;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = this.terrain.heightAt(x, z);
      if (h < 3 || this.terrain.flatness(x, z) < 0.992 || inSite(x, z, 40) || this.occ.test(x, z, 8)) continue;
      if (this.terrain.flatness(x + 3, z + 3) < 0.99 || this.terrain.flatness(x - 3, z - 3) < 0.99) continue;
      const yaw = rng() * Math.PI * 2;
      if (shacks % 4 === 3) {
        tent(ctx, x, h - 0.05, z, yaw);
        crate(ctx, x + Math.cos(yaw) * 4.2, this.terrain.heightAt(x + Math.cos(yaw) * 4.2, z - Math.sin(yaw) * 4.2) - 0.05, z - Math.sin(yaw) * 4.2, rng() * 3, 0.9, 0x56603f);
        this.occ.add(x, z, 5.5);
      } else {
        BUILDERS.shack(ctx, x, h + 0.1, z, yaw);
        this.occ.add(x, z, 4.4);
        if (rng() < 0.6) {
          const bx = x + Math.cos(yaw + 1.2) * 4.6;
          const bz = z - Math.sin(yaw + 1.2) * 4.6;
          logPile(ctx, bx, this.terrain.heightAt(bx, bz) - 0.08, bz, yaw);
          this.occ.add(bx, bz, 2.4);
        }
      }
      this.terrain.paintGround(x, z, 7, 0.7);
      shacks++;
    }
    // radio mast on the highest peak outside settlements
    let bx = 0;
    let bz = 0;
    let bh = -1;
    for (let gz = -ISLAND_RADIUS; gz <= ISLAND_RADIUS; gz += 12) for (let gx = -ISLAND_RADIUS; gx <= ISLAND_RADIUS; gx += 12) {
      const h = this.terrain.heightAt(gx, gz);
      if (h > bh && !inSite(gx, gz, 50)) {
        bh = h;
        bx = gx;
        bz = gz;
      }
    }
    if (bh > 10) {
      let low = bh;
      for (let k = 0; k < 8; k++) low = Math.min(low, this.terrain.heightAt(bx + Math.cos(k * 0.785) * 3.2, bz + Math.sin(k * 0.785) * 3.2));
      radioMast(ctx, bx, low + 0.6, bz);
      this.occ.add(bx, bz, 8);
      this.terrain.paintGround(bx, bz, 9, 0.8);
    }
    this.meshesFrom(gb);
  }

  // ------------------------------------------------------------ queries

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** index of the building whose footprint contains the point, or -1 */
  buildingAt(x: number, z: number): number {
    const bs = this.buildings;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz > 160) continue;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) return i;
    }
    return -1;
  }

  /** Bullet / sight ray against terrain, water and static geometry. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, hit: WorldHit, water = true): boolean {
    let best = maxDist;
    let found = false;
    const h = this.hitTmp;
    if (this.colliders.raycast(ox, oy, oz, dx, dy, dz, best, h)) {
      best = h.t;
      found = true;
      hit.nx = h.nx;
      hit.ny = h.ny;
      hit.nz = h.nz;
      hit.surf = h.surf;
    }
    const tt = this.terrain.raycast(ox, oy, oz, dx, dy, dz, best);
    if (tt >= 0 && tt < best) {
      best = tt;
      found = true;
      const px = ox + dx * tt;
      const pz = oz + dz * tt;
      const k = this.terrain.normalAt(px, pz, _n);
      hit.nx = k.x;
      hit.ny = k.y;
      hit.nz = k.z;
      hit.surf = SURF_DIRT;
    }
    if (water && dy < -1e-5 && oy > 0) {
      const tw = -oy / dy;
      if (tw < best) {
        best = tw;
        found = true;
        hit.nx = 0;
        hit.ny = 1;
        hit.nz = 0;
        hit.surf = SURF_WATER;
      }
    }
    if (found) {
      hit.t = best;
      hit.x = ox + dx * best;
      hit.y = oy + dy * best;
      hit.z = oz + dz * best;
    }
    return found;
  }

  /** true when nothing solid lies between the two points */
  clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    dx /= len;
    dy /= len;
    dz /= len;
    if (this.colliders.raycast(ax, ay, az, dx, dy, dz, len - 0.05, this.hitTmp)) return false;
    return this.terrain.raycast(ax, ay, az, dx, dy, dz, len - 0.05) < 0;
  }

  nearestSite(x: number, z: number): SiteDef {
    let best = this.sites[0];
    let bd = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(x - s.x, z - s.z) - s.radius;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.env.update(dt, camera);
    this.vegetation.update(dt, camera.position);
  }

  /** Top-down map used by the minimap and the full screen map. */
  renderMap(size: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(size, size);
    const t = this.terrain;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px / size) * WORLD_SIZE - WORLD_HALF;
        const z = (py / size) * WORLD_SIZE - WORLD_HALF;
        const h = t.heightAt(x, z);
        const hx = t.heightAt(x + 4, z) - h;
        const hz = t.heightAt(x, z + 4) - h;
        const shade = clamp(1 + (hx * -0.09 + hz * -0.07), 0.55, 1.4);
        let r: number;
        let gg: number;
        let b: number;
        if (h < 0) {
          const d = clamp(-h / 14, 0, 1);
          r = lerp(74, 26, d);
          gg = lerp(134, 66, d);
          b = lerp(152, 104, d);
        } else {
          const k = clamp(h / 60, 0, 1);
          r = lerp(126, 158, k);
          gg = lerp(150, 148, k);
          b = lerp(92, 118, k);
          if (h < 2.2) {
            r = 204;
            gg = 190;
            b = 148;
          }
          const forest = this.noise.fbm(x * 0.0045 + 50, z * 0.0045 - 20, 3) * 0.5 + 0.5;
          if (forest > 0.52 && h > 2.4) {
            r -= 26;
            gg -= 12;
            b -= 22;
          }
          const road = t.splatAt(x, z, 0);
          const town = t.splatAt(x, z, 1);
          r = lerp(r, 196, town * 0.5);
          gg = lerp(gg, 178, town * 0.5);
          b = lerp(b, 140, town * 0.5);
          r = lerp(r, 232, road * 0.9);
          gg = lerp(gg, 220, road * 0.9);
          b = lerp(b, 190, road * 0.9);
          r *= shade;
          gg *= shade;
          b *= shade;
        }
        const i = (py * size + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const sc = size / WORLD_SIZE;
    g.fillStyle = 'rgba(52,44,38,0.92)';
    for (const b of this.buildings) {
      g.save();
      g.translate((b.x + WORLD_HALF) * sc, (b.z + WORLD_HALF) * sc);
      g.rotate(-b.yaw);
      g.fillRect(-b.hx * sc, -b.hz * sc, b.hx * 2 * sc, b.hz * 2 * sc);
      g.restore();
    }
    g.textAlign = 'center';
    g.font = `600 ${Math.round(size / 58)}px system-ui, sans-serif`;
    for (const s of this.sites) {
      const px = (s.x + WORLD_HALF) * sc;
      const py = (s.z + WORLD_HALF) * sc - s.radius * sc - 4;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(20,24,28,0.75)';
      g.strokeText(s.name, px, py);
      g.fillStyle = '#f4efe2';
      g.fillText(s.name, px, py);
    }
    return cv;
  }
}

const _n = new THREE.Vector3();
