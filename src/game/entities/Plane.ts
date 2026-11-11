import * as THREE from 'three';
import { GeoBuilder } from '../core/GeoBuilder';
import type { Rng } from '../core/math';
import type { Character } from './Character';

const ALTITUDE = 330;
const SPEED = 58;
const RADIUS = 760;

/** The transport that carries everyone over the island at the start of a match. */
export class Plane {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  dir = new THREE.Vector3(1, 0, 0);
  from = new THREE.Vector3();
  to = new THREE.Vector3();
  progress = 0;
  active = false;
  canJump = false;
  speed = SPEED;
  private props: THREE.Mesh[] = [];
  private jumpTimes = new Map<number, number>();
  private clock = 0;

  constructor() {
    const gb = new GeoBuilder();
    const m = 'm';
    const body = 0x6f7a72;
    const dark = 0x3c4540;
    const RX = Math.PI / 2;
    // fuselage along +Z
    gb.cyl(m, 0, 0, 0, 2.3, 2.3, 22, body, 18, { rx: RX });
    gb.cyl(m, 0, 0, 13.6, 0.9, 2.3, 5.2, body, 18, { rx: RX });
    gb.sphere(m, 0, 0, 16.1, 0.92, dark, 1, 1, 1.4, 12);
    gb.cyl(m, 0, 0.9, -16, 2.3, 0.7, 10, body, 18, { rx: RX });
    gb.box(m, 0, -1.5, -13, 3.4, 1.4, 9, body, { rx: -0.2 });
    // cockpit glazing + stripe
    gb.box(m, 0, 1.25, 13.2, 2.4, 0.9, 2.2, 0x1c262c, { rx: 0.5 });
    gb.box(m, 0, 0.2, 0, 4.66, 0.5, 22, dark);
    for (let k = -3; k <= 3; k++) for (const sx of [-1, 1]) gb.cyl(m, sx * 2.28, 0.9, k * 2.6, 0.3, 0.3, 0.1, 0x1c262c, 8, { rz: RX });
    // high wing
    gb.box(m, 0, 2.4, 1.5, 38, 0.55, 5.2, body);
    gb.box(m, 0, 2.7, 1.5, 9, 0.8, 5.6, body);
    for (const sx of [-1, 1]) {
      gb.box(m, sx * 18.6, 2.5, 1.2, 1.2, 0.5, 3.6, dark);
      for (const ex of [5.6, 11.6]) {
        gb.cyl(m, sx * ex, 1.75, 3.6, 0.72, 0.8, 4.6, dark, 12, { rx: RX });
        gb.sphere(m, sx * ex, 1.75, 6.2, 0.42, 0x1d1f21, 1, 1, 1.5, 8);
      }
      gb.box(m, sx * 2.6, -1.5, 0.5, 1.3, 1.5, 6.5, dark);
    }
    // tail
    gb.box(m, 0, 5.6, -19, 0.5, 7.4, 5.2, body, { rx: -0.35 });
    gb.box(m, 0, 2.8, -20, 13.5, 0.35, 3.4, body);
    gb.box(m, 0, 8.6, -20.6, 0.55, 1.0, 3.2, 0xb8442e);
    const geo = gb.build()[m];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    this.group.add(mesh);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    for (const sx of [-1, 1]) for (const ex of [5.6, 11.6]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.25, 20), discMat);
      disc.position.set(sx * ex, 1.75, 6.5);
      this.group.add(disc);
      this.props.push(disc);
    }
    this.group.visible = false;
  }

  start(rng: Rng): void {
    const a = rng() * Math.PI * 2;
    this.dir.set(Math.cos(a), 0, Math.sin(a));
    const off = (rng() - 0.5) * 320;
    const px = -this.dir.z * off;
    const pz = this.dir.x * off;
    this.from.set(-this.dir.x * RADIUS + px, ALTITUDE, -this.dir.z * RADIUS + pz);
    this.to.set(this.dir.x * RADIUS + px, ALTITUDE, this.dir.z * RADIUS + pz);
    this.pos.copy(this.from);
    this.progress = 0;
    this.active = true;
    this.canJump = false;
    this.clock = 0;
    this.jumpTimes.clear();
    this.group.visible = true;
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
  }

  /** fraction along the flight where the aircraft passes closest to a point */
  closest(x: number, z: number): { t: number; miss: number } {
    const lx = this.to.x - this.from.x;
    const lz = this.to.z - this.from.z;
    const len2 = lx * lx + lz * lz;
    const t = ((x - this.from.x) * lx + (z - this.from.z) * lz) / len2;
    const cx = this.from.x + lx * t;
    const cz = this.from.z + lz * t;
    return { t, miss: Math.hypot(x - cx, z - cz) };
  }

  noteJump(c: Character): void {
    this.jumpTimes.set(c.id, this.clock);
  }
  sinceJump(c: Character): number {
    return this.clock - (this.jumpTimes.get(c.id) ?? this.clock);
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.active) return;
    const total = this.from.distanceTo(this.to);
    this.progress += (this.speed * dt) / total;
    this.pos.lerpVectors(this.from, this.to, Math.min(1.25, this.progress));
    this.group.position.copy(this.pos);
    this.group.rotation.z = Math.sin(this.clock * 0.6) * 0.02;
    const r = Math.hypot(this.pos.x, this.pos.z);
    this.canJump = this.progress > 0.06 && this.progress < 0.93 && r < 640;
    for (const p of this.props) p.rotation.z += dt * 40;
    if (this.progress >= 1.25) {
      this.active = false;
      this.group.visible = false;
    }
  }

  stop(): void {
    this.active = false;
    this.canJump = false;
    this.group.visible = false;
  }
}
