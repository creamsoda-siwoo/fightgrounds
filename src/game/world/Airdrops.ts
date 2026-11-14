import * as THREE from 'three';
import { GeoBuilder } from '../core/GeoBuilder';
import type { Rng } from '../core/math';
import { getModels } from '../entities/Models';
import type { Game } from '../Game';
import { AMMO_STACK, ARMOR, WEAPONS, type Item } from '../items/defs';
import { SURF_METAL } from './Colliders';

const FALL_SPEED = 7.5;
const DROP_HEIGHT = 190;

interface Drop {
  group: THREE.Group;
  chute: THREE.Mesh;
  x: number;
  z: number;
  y: number;
  ground: number;
  landed: boolean;
  smokeT: number;
  age: number;
}

/** Supply crates parachuted into the next safe zone, carrying top-tier loot. */
export class Airdrops {
  group = new THREE.Group();
  drops: Drop[] = [];
  private crateGeo: THREE.BufferGeometry;
  private crateMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 });

  constructor(private game: Game) {
    const gb = new GeoBuilder();
    const m = 'm';
    gb.box(m, 0, 0.55, 0, 1.6, 1.1, 1.6, 0x2f5b8c);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.box(m, sx * 0.76, 0.55, sz * 0.76, 0.12, 1.14, 0.12, 0x1b2430);
    for (const y of [0.06, 1.06]) {
      gb.box(m, 0, y, 0.76, 1.6, 0.12, 0.12, 0x1b2430);
      gb.box(m, 0, y, -0.76, 1.6, 0.12, 0.12, 0x1b2430);
      gb.box(m, 0.76, y, 0, 0.12, 0.12, 1.6, 0x1b2430);
      gb.box(m, -0.76, y, 0, 0.12, 0.12, 1.6, 0x1b2430);
    }
    gb.box(m, 0, 0.55, 0.81, 1.0, 0.28, 0.02, 0xd9481e);
    gb.box(m, 0, 0.55, -0.81, 1.0, 0.28, 0.02, 0xd9481e);
    gb.box(m, 0.81, 0.55, 0, 0.02, 0.28, 1.0, 0xd9481e);
    gb.box(m, -0.81, 0.55, 0, 0.02, 0.28, 1.0, 0xd9481e);
    gb.box(m, 0, 1.13, 0, 0.5, 0.04, 0.5, 0xf2efe6);
    this.crateGeo = gb.build()[m];
  }

  get active(): boolean {
    return this.drops.some((d) => !d.landed);
  }

  clear(): void {
    for (const d of this.drops) this.group.remove(d.group);
    this.drops.length = 0;
  }

  /** drop one crate somewhere dry inside the circle */
  spawn(cx: number, cz: number, r: number, rng: Rng): { x: number; z: number } | null {
    const world = this.game.world;
    for (let k = 0; k < 24; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r * 0.75;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const h = world.heightAt(x, z);
      if (h < 1.5 || world.terrain.flatness(x, z) < 0.9) continue;
      if (world.buildingAt(x, z) >= 0) continue;
      const g = new THREE.Group();
      const crate = new THREE.Mesh(this.crateGeo, this.crateMat);
      crate.castShadow = true;
      g.add(crate);
      const lib = getModels();
      const chute = new THREE.Mesh(lib.chute, lib.chuteMat);
      chute.scale.setScalar(1.15);
      chute.position.y = -0.4;
      g.add(chute);
      g.position.set(x, h + DROP_HEIGHT, z);
      this.group.add(g);
      this.drops.push({ group: g, chute, x, z, y: h + DROP_HEIGHT, ground: h, landed: false, smokeT: 0, age: 0 });
      return { x, z };
    }
    return null;
  }

  private contents(rng: Rng): Item[] {
    const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
    const wid = pick(['longbow', 'ranger', 'bulwark', 'kestrel']);
    const w = WEAPONS[wid];
    return [
      { kind: 'weapon', sub: wid, n: w.mag },
      { kind: 'ammo', sub: w.ammo, n: AMMO_STACK[w.ammo] * 2 },
      { kind: 'ammo', sub: w.ammo, n: AMMO_STACK[w.ammo] * 2 },
      { kind: rng() < 0.5 ? 'helmet' : 'vest', n: 3, dur: ARMOR[3].dur },
      { kind: 'medkit', n: 1 },
      { kind: 'drink', n: 1 },
      { kind: 'grenade', n: 1 },
      { kind: 'scope', n: rng() < 0.6 ? 8 : 4 },
    ];
  }

  update(dt: number, rng: Rng): void {
    const game = this.game;
    for (const d of this.drops) {
      d.age += dt;
      if (!d.landed) {
        d.y -= FALL_SPEED * dt;
        d.group.position.y = d.y;
        d.group.rotation.y += dt * 0.25;
        d.chute.rotation.z = Math.sin(d.age * 1.3) * 0.06;
        if (d.y <= d.ground) {
          d.y = d.ground;
          d.group.position.y = d.ground;
          d.landed = true;
          d.group.remove(d.chute);
          game.world.colliders.addBox(d.x, d.z, 0.8, 0.8, d.group.rotation.y, d.ground - 0.5, d.ground + 1.15, SURF_METAL);
          game.loot.scatter(this.contents(rng), d.x, d.ground, d.z, -1, false, rng);
          game.effects.dust(d.x, d.ground, d.z, 10);
          game.audio.impact(SURF_METAL, d.x, d.ground + 0.5, d.z);
          game.noise(d.x, d.z, 260, null);
        }
      }
      // red marker smoke while the crate is fresh
      d.smokeT -= dt;
      if (d.smokeT <= 0 && d.age < 120) {
        d.smokeT = 0.18;
        const cam = game.camera.position;
        if (Math.hypot(d.x - cam.x, d.z - cam.z) < 500) game.effects.puff(d.x + 0.9, (d.landed ? d.ground : d.y) + 0.3, d.z, 0.85, 0.16, 0.12);
      }
    }
  }
}
