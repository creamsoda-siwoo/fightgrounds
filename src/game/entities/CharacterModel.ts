import * as THREE from 'three';
import { GeoBuilder } from '../core/GeoBuilder';
import { clamp, damp, lerp } from '../core/math';
import { getModels, type WeaponModel } from './Models';

/**
 * A fully procedural humanoid: one skinned mesh driven by an 18 bone rig.
 * Locomotion and weapon handling are solved every frame with two-bone IK
 * instead of baked clips, so the same rig can walk, crouch, aim, reload,
 * sky-dive, swim and collapse.
 */

const B = {
  root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5,
  armL: 6, foreL: 7, handL: 8, armR: 9, foreR: 10, handR: 11,
  thighL: 12, shinL: 13, footL: 14, thighR: 15, shinR: 16, footR: 17,
};
const PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13, 1, 15, 16];
/** rest positions in model space (feet at origin, facing +Z, right side is -X) */
const REST: [number, number, number][] = [
  [0, 0, 0], [0, 0.96, 0], [0, 1.08, 0], [0, 1.26, 0], [0, 1.5, 0], [0, 1.58, 0.01],
  [0.2, 1.46, 0], [0.2, 1.17, 0], [0.2, 0.91, 0],
  [-0.2, 1.46, 0], [-0.2, 1.17, 0], [-0.2, 0.91, 0],
  [0.095, 0.93, 0], [0.095, 0.49, 0], [0.095, 0.07, 0],
  [-0.095, 0.93, 0], [-0.095, 0.49, 0], [-0.095, 0.07, 0],
];
const UPPER_ARM = 0.29;
const FORE_ARM = 0.26;
const THIGH = 0.44;
const SHIN = 0.42;
const HIP_REST = 0.96;

export interface Outfit {
  skin: number;
  hair: number;
  top: number;
  pants: number;
  boots: number;
  glove: number;
  pack: number;
  cap: number | null;
  sleeves: boolean;
}

export const OUTFITS: Outfit[] = [
  { skin: 0xd6a384, hair: 0x2a1d14, top: 0x4d5b3c, pants: 0x3b3e33, boots: 0x2a211a, glove: 0x1f1f1f, pack: 0x5a5440, cap: null, sleeves: true },
  { skin: 0xb8815d, hair: 0x15110d, top: 0x2f4058, pants: 0x6a5f48, boots: 0x33291f, glove: 0x2a2a2a, pack: 0x3a4a3a, cap: 0x26303c, sleeves: true },
  { skin: 0xe6c0a0, hair: 0x8a6a3a, top: 0x8a322b, pants: 0x2f3848, boots: 0x3a2c1e, glove: 0x4a3a2a, pack: 0x4a4a4a, cap: null, sleeves: false },
  { skin: 0x8a5a3c, hair: 0x0f0d0b, top: 0x8f7e4d, pants: 0x3f4a33, boots: 0x231c16, glove: 0x1f1f1f, pack: 0x6a5a3a, cap: 0x5a5236, sleeves: true },
  { skin: 0xdcae8c, hair: 0x4a2f1c, top: 0x3c3e42, pants: 0x25282d, boots: 0x1c1c1c, glove: 0x15171a, pack: 0x2f3338, cap: null, sleeves: true },
  { skin: 0xc99872, hair: 0x1c1c1c, top: 0x54696f, pants: 0x5c4c3a, boots: 0x2a211a, glove: 0x3a3a3a, pack: 0x6f5a3a, cap: 0x8a3a2a, sleeves: false },
  { skin: 0xe2b796, hair: 0x6a3a1c, top: 0x2c2c2e, pants: 0x505b45, boots: 0x2a241c, glove: 0x1f1f1f, pack: 0x444c38, cap: null, sleeves: true },
  { skin: 0xa87550, hair: 0x221812, top: 0xc4b185, pants: 0x35312b, boots: 0x3a2c1e, glove: 0x4a3a2a, pack: 0x5a4a3a, cap: 0x35312b, sleeves: true },
];

const geoCache = new Map<number, THREE.BufferGeometry>();
let bodyMat: THREE.MeshStandardMaterial | null = null;

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

function bodyGeometry(variant: number): THREE.BufferGeometry {
  const cached = geoCache.get(variant);
  if (cached) return cached;
  const o = OUTFITS[variant % OUTFITS.length];
  const gb = new GeoBuilder();
  const m = 'body';
  const part = (bone: number) => {
    gb.bone = bone;
  };
  const taper = (x: number, y: number, z: number, rt: number, rb: number, h: number, c: number, sz = 1) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 12, 1);
    const mat = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, sz));
    gb.geo(m, g, c, mat);
    g.dispose();
  };
  // pelvis & belt
  part(B.hips);
  gb.sphere(m, 0, 0.95, 0, 0.17, o.pants, 1.0, 0.76, 0.72, 12);
  taper(0, 1.035, 0, 0.158, 0.163, 0.055, 0x1c1814, 0.7);
  gb.box(m, 0, 1.035, 0.115, 0.05, 0.045, 0.012, 0x9a8c5a);
  gb.box(m, -0.15, 0.98, 0.02, 0.05, 0.11, 0.09, shade(o.pack, 0.8));
  gb.box(m, 0.15, 0.99, -0.02, 0.045, 0.09, 0.08, shade(o.pack, 0.7));
  // abdomen
  part(B.spine);
  taper(0, 1.14, 0, 0.158, 0.156, 0.2, o.top, 0.7);
  // rib cage, shoulders, collar, backpack
  part(B.chest);
  gb.sphere(m, 0, 1.335, 0, 0.2, o.top, 0.97, 0.98, 0.63, 14);
  gb.capsule(m, 0, 1.452, -0.005, 0.082, 0.5, o.top, { rz: Math.PI / 2, sz: 0.95 });
  taper(0, 1.5, 0, 0.066, 0.085, 0.05, shade(o.top, 0.8), 0.95);
  gb.box(m, 0, 1.3, 0.127, 0.012, 0.3, 0.004, shade(o.top, 0.7));
  gb.box(m, 0.085, 1.38, 0.118, 0.07, 0.06, 0.012, shade(o.top, 0.82));
  gb.box(m, 0, 1.31, -0.19, 0.27, 0.34, 0.13, o.pack);
  gb.box(m, 0, 1.44, -0.2, 0.25, 0.09, 0.15, shade(o.pack, 0.85));
  gb.box(m, 0, 1.22, -0.265, 0.2, 0.13, 0.04, shade(o.pack, 0.75));
  gb.box(m, 0, 1.49, -0.2, 0.2, 0.05, 0.11, shade(o.pack, 1.15));
  for (const sx of [-1, 1]) {
    gb.box(m, sx * 0.11, 1.38, 0.05, 0.04, 0.3, 0.016, shade(o.pack, 0.7), { rx: -0.1 });
    gb.box(m, sx * 0.115, 1.47, -0.05, 0.04, 0.02, 0.22, shade(o.pack, 0.7));
    gb.box(m, sx * 0.15, 1.24, -0.2, 0.03, 0.14, 0.09, shade(o.pack, 0.8));
  }
  // neck & head
  part(B.neck);
  taper(0, 1.54, 0.004, 0.05, 0.056, 0.1, o.skin);
  part(B.head);
  gb.sphere(m, 0, 1.69, 0.015, 0.105, o.skin, 0.93, 1.08, 1.0, 14);
  gb.sphere(m, 0, 1.635, 0.032, 0.086, o.skin, 0.9, 0.92, 0.95, 12);
  gb.box(m, 0, 1.672, 0.118, 0.026, 0.044, 0.03, shade(o.skin, 0.94), { rx: -0.2 });
  for (const sx of [-1, 1]) {
    gb.sphere(m, sx * 0.098, 1.68, 0.006, 0.022, shade(o.skin, 0.92), 0.5, 1.2, 0.9, 6);
    gb.sphere(m, sx * 0.036, 1.7, 0.103, 0.013, 0xf2efe8, 1.2, 0.8, 0.6, 6);
    gb.sphere(m, sx * 0.036, 1.7, 0.111, 0.007, 0x1c1410, 1, 1, 0.5, 6);
    gb.box(m, sx * 0.037, 1.722, 0.106, 0.04, 0.008, 0.012, shade(o.hair, 0.9), { rz: sx * -0.12 });
  }
  gb.box(m, 0, 1.628, 0.107, 0.044, 0.007, 0.01, shade(o.skin, 0.72));
  if (o.cap !== null) {
    gb.sphere(m, 0, 1.735, 0.0, 0.112, o.cap, 0.98, 0.72, 1.04, 12);
    gb.box(m, 0, 1.738, 0.13, 0.15, 0.012, 0.1, shade(o.cap, 0.85), { rx: 0.12 });
    gb.sphere(m, 0, 1.69, -0.03, 0.1, o.hair, 0.98, 0.9, 0.95, 10);
  } else {
    gb.sphere(m, 0, 1.722, -0.018, 0.109, o.hair, 0.97, 0.86, 1.02, 12);
    gb.sphere(m, 0, 1.675, -0.05, 0.092, o.hair, 1.0, 0.95, 0.9, 10);
  }
  // arms
  for (const s of [1, -1]) {
    const x = s * 0.2;
    part(s > 0 ? B.armL : B.armR);
    gb.sphere(m, x, 1.46, 0, 0.078, o.top, 1, 1, 1, 10);
    taper(x, 1.315, 0, 0.062, 0.05, 0.28, o.top);
    part(s > 0 ? B.foreL : B.foreR);
    const sleeve = o.sleeves ? o.top : o.skin;
    gb.sphere(m, x, 1.17, 0, 0.052, sleeve, 1, 1, 1, 8);
    taper(x, 1.045, 0, 0.049, 0.038, 0.25, sleeve);
    if (o.sleeves) taper(x, 0.935, 0, 0.043, 0.041, 0.03, shade(o.top, 0.75));
    part(s > 0 ? B.handL : B.handR);
    gb.box(m, x, 0.865, 0.004, 0.036, 0.09, 0.075, o.glove);
    gb.box(m, x, 0.81, 0.008, 0.032, 0.05, 0.065, shade(o.glove, 1.25));
    gb.box(m, x, 0.862, 0.05, 0.026, 0.05, 0.026, o.glove, { rx: -0.5 });
    taper(x, 0.905, 0, 0.04, 0.036, 0.03, shade(o.glove, 0.8));
  }
  // legs
  for (const s of [1, -1]) {
    const x = s * 0.095;
    part(s > 0 ? B.thighL : B.thighR);
    gb.sphere(m, x, 0.93, 0, 0.088, o.pants, 1, 1, 1, 10);
    taper(x, 0.71, 0, 0.088, 0.064, 0.43, o.pants);
    gb.box(m, x + s * 0.075, 0.75, 0.0, 0.03, 0.13, 0.1, shade(o.pants, 0.82));
    part(s > 0 ? B.shinL : B.shinR);
    gb.sphere(m, x, 0.49, 0, 0.064, o.pants, 1, 1, 1, 8);
    taper(x, 0.29, 0, 0.06, 0.046, 0.38, o.pants);
    gb.box(m, x, 0.49, 0.055, 0.1, 0.12, 0.03, 0x1f2124);
    gb.box(m, x, 0.49, 0.072, 0.07, 0.08, 0.012, 0x33363a);
    part(s > 0 ? B.footL : B.footR);
    taper(x, 0.13, 0, 0.054, 0.058, 0.16, o.boots);
    gb.box(m, x, 0.05, 0.045, 0.095, 0.075, 0.2, o.boots);
    gb.sphere(m, x, 0.05, 0.14, 0.05, o.boots, 0.95, 0.75, 1.1, 8);
    gb.box(m, x, 0.012, 0.055, 0.1, 0.024, 0.27, 0x121212);
    gb.box(m, x, 0.11, 0.058, 0.06, 0.07, 0.012, shade(o.boots, 1.5));
  }
  const g = gb.build()[m];
  geoCache.set(variant, g);
  return g;
}

export type AnimMode = 'ground' | 'freefall' | 'chute' | 'swim' | 'dead';

export interface AnimInput {
  mode: AnimMode;
  /** horizontal speed m/s */
  speed: number;
  /** movement direction in character space (x = left, z = forward) */
  moveX: number;
  moveZ: number;
  crouch: boolean;
  sprint: boolean;
  grounded: boolean;
  /** aim pitch, positive looks up */
  pitch: number;
  weapon: string | null;
  ads: boolean;
  /** 0..1 progress, -1 when idle */
  reload: number;
  heal: number;
  healKind: string;
  throwing: number;
  punch: number;
  /** seconds since death */
  deadT: number;
  deadDir: number;
  /** recoil impulse added by the owner when firing */
  kick: number;
}

export function defaultAnim(): AnimInput {
  return {
    mode: 'ground', speed: 0, moveX: 0, moveZ: 1, crouch: false, sprint: false, grounded: true, pitch: 0, weapon: null, ads: false,
    reload: -1, heal: -1, healKind: '', throwing: -1, punch: -1, deadT: 0, deadDir: 1, kick: 0,
  };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qci = new THREE.Quaternion();
const _pc = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _e = new THREE.Euler();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function eulerQ(out: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion {
  _e.set(x, y, z, 'YXZ');
  return out.setFromEuler(_e);
}

/**
 * Analytic two bone IK. `root`, `target` and `pole` are in the parent space
 * of the upper bone; both bones point down -Y at rest.
 */
function solve2(upper: THREE.Quaternion, lower: THREE.Quaternion, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number): void {
  _dir.subVectors(target, root);
  let d = _dir.length();
  if (d < 1e-4) {
    _dir.set(0, -1, 0);
    d = 1e-4;
  } else _dir.multiplyScalar(1 / d);
  d = clamp(d, Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.004);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_perp.lengthSq() < 1e-6) _perp.set(_dir.y, -_dir.x, 0.2);
  _perp.normalize();
  _v1.copy(_dir).multiplyScalar(cosA).addScaledVector(_perp, sinA); // upper direction
  _v2.copy(root).addScaledVector(_v1, l1); // joint
  _v3.copy(root).addScaledVector(_dir, d).sub(_v2).normalize(); // lower direction
  upper.setFromUnitVectors(DOWN, _v1);
  _q1.setFromUnitVectors(DOWN, _v3);
  lower.copy(upper).invert().multiply(_q1);
}

export class CharacterModel {
  group = new THREE.Group();
  private pivot = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[] = [];
  private weaponHolder = new THREE.Group();
  private weaponMesh: THREE.Mesh;
  private backMesh: THREE.Mesh;
  private helmetMesh: THREE.Mesh;
  private vestMesh: THREE.Mesh;
  private chuteMesh: THREE.Mesh;
  private nadeMesh: THREE.Mesh;
  private phase = Math.random();
  private crouchT = 0;
  private armedT = 0;
  private adsT = 0;
  private sprintT = 0;
  private moveT = 0;
  private idleT = Math.random() * 10;
  private kickT = 0;
  private curWeapon: string | null = null;
  private curBack: string | null = null;
  private wm: WeaponModel | null = null;
  /** muzzle position in model space, refreshed by update() */
  muzzle = new THREE.Vector3(-0.1, 1.45, 0.7);
  private tq: THREE.Quaternion[] = [];
  private hipPos = new THREE.Vector3(0, HIP_REST, 0);
  private lean = 0;

  constructor(variant: number) {
    const lib = getModels();
    if (!bodyMat) bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 });
    for (let i = 0; i < REST.length; i++) {
      const b = new THREE.Bone();
      const p = PARENT[i];
      if (p >= 0) {
        b.position.set(REST[i][0] - REST[p][0], REST[i][1] - REST[p][1], REST[i][2] - REST[p][2]);
        this.bones[p].add(b);
      }
      this.bones.push(b);
      this.tq.push(new THREE.Quaternion());
    }
    this.bones[0].updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(bodyGeometry(variant), bodyMat);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(skeleton);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pivot.add(this.mesh);
    this.group.add(this.pivot);

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mm = new THREE.Mesh(geo, mat);
      mm.castShadow = true;
      mm.frustumCulled = false;
      mm.visible = false;
      return mm;
    };
    this.weaponMesh = mk(lib.weapons.kestrel.geo, lib.weaponMat);
    this.weaponHolder.add(this.weaponMesh);
    this.bones[B.chest].add(this.weaponHolder);
    this.backMesh = mk(lib.weapons.kestrel.geo, lib.weaponMat);
    // slung flat across the pack, barrel up and to the left
    const bz = new THREE.Vector3(Math.sin(0.45), Math.cos(0.45), 0);
    const bx = new THREE.Vector3(0, 0, 1);
    const by = new THREE.Vector3().crossVectors(bz, bx);
    this.backMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
    this.backMesh.position.set(-0.03, -0.12, -0.285);
    this.bones[B.chest].add(this.backMesh);
    this.helmetMesh = mk(lib.helmet[1], lib.gearMat);
    this.bones[B.head].add(this.helmetMesh);
    this.vestMesh = mk(lib.vest[1], lib.gearMat);
    this.vestMesh.position.set(0, 0.04, 0);
    this.bones[B.chest].add(this.vestMesh);
    this.nadeMesh = mk(lib.grenade, lib.gearMat);
    this.nadeMesh.position.set(0, -0.09, 0.03);
    this.bones[B.handR].add(this.nadeMesh);
    this.chuteMesh = mk(lib.chute, lib.chuteMat);
    this.group.add(this.chuteMesh);
  }

  setGear(helmet: number, vest: number): void {
    const lib = getModels();
    this.helmetMesh.visible = helmet > 0;
    if (helmet > 0) this.helmetMesh.geometry = lib.helmet[helmet];
    this.vestMesh.visible = vest > 0;
    if (vest > 0) this.vestMesh.geometry = lib.vest[vest];
  }

  setWeapons(active: string | null, back: string | null): void {
    const lib = getModels();
    if (active !== this.curWeapon) {
      this.curWeapon = active;
      this.wm = active ? lib.weapons[active] : null;
      if (this.wm) this.weaponMesh.geometry = this.wm.geo;
    }
    if (back !== this.curBack) {
      this.curBack = back;
      if (back) this.backMesh.geometry = lib.weapons[back].geo;
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** world position of the muzzle given the owner transform */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.muzzle).applyQuaternion(this.pivot.quaternion).add(this.pivot.position).applyQuaternion(this.group.quaternion).add(this.group.position);
  }

  update(dt: number, a: AnimInput): void {
    const q = this.tq;
    const bones = this.bones;
    this.idleT += dt;
    const armed = a.weapon !== null && a.mode === 'ground';
    const busy = a.heal >= 0 || a.throwing >= 0;
    this.crouchT = lerp(this.crouchT, a.crouch && a.mode === 'ground' ? 1 : 0, damp(11, dt));
    this.armedT = lerp(this.armedT, armed && !busy ? 1 : 0, damp(12, dt));
    this.adsT = lerp(this.adsT, a.ads ? 1 : 0, damp(14, dt));
    this.sprintT = lerp(this.sprintT, a.sprint && a.speed > 4 ? 1 : 0, damp(9, dt));
    const moving = a.mode === 'ground' && a.speed > 0.25 && a.grounded;
    this.moveT = lerp(this.moveT, moving ? 1 : 0, damp(10, dt));
    this.kickT = Math.max(0, this.kickT - dt * 9) + a.kick;
    if (this.kickT > 1.4) this.kickT = 1.4;
    a.kick = 0;
    if (moving) this.phase = (this.phase + dt * (0.6 + a.speed * 0.145)) % 1;

    const cr = this.crouchT;
    const mv = this.moveT;
    const breathe = Math.sin(this.idleT * 1.7) * 0.004;
    for (let i = 0; i < q.length; i++) q[i].identity();

    // ---------------------------------------------------------- root pose
    let pivotRx = 0;
    let pivotY = 0;
    let hipY = HIP_REST - cr * 0.36 - mv * (0.035 + this.sprintT * 0.03) + breathe;
    let hipLean = cr * 0.34 + mv * (0.06 + this.sprintT * 0.2);
    const bob = mv * Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.035;
    hipY -= bob;
    const twist = armed ? -0.32 * this.armedT * (1 - this.sprintT) : 0;

    if (a.mode === 'freefall') {
      pivotRx = 1.32 + Math.sin(this.idleT * 3) * 0.03;
      pivotY = 0.9;
      hipLean = -0.2;
      hipY = HIP_REST;
    } else if (a.mode === 'chute') {
      hipLean = 0.05 + Math.sin(this.idleT * 1.3) * 0.05;
      hipY = HIP_REST;
    } else if (a.mode === 'swim') {
      pivotRx = 1.18;
      pivotY = 0.55;
      hipLean = 0;
      hipY = HIP_REST;
    } else if (a.mode === 'dead') {
      const t = clamp(a.deadT / 0.75, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      pivotRx = -a.deadDir * e * (Math.PI / 2 - 0.04);
      pivotY = e * 0.14;
      hipLean = 0;
      hipY = HIP_REST - e * 0.02;
    }
    this.lean = lerp(this.lean, hipLean, damp(12, dt));
    this.pivot.rotation.x = lerp(this.pivot.rotation.x, pivotRx, a.mode === 'dead' ? 1 : damp(6, dt));
    this.pivot.position.y = lerp(this.pivot.position.y, pivotY, a.mode === 'dead' ? 1 : damp(6, dt));
    this.hipPos.set(0, lerp(this.hipPos.y, hipY, damp(18, dt)), 0);

    const sway = mv * Math.sin(this.phase * Math.PI * 2) * 0.05;
    eulerQ(_qh, this.lean, twist + sway * 0.5, sway * 0.3);
    q[B.hips].copy(_qh);

    // aim pitch is spread over the spine so the whole torso follows the sights
    const pitch = a.mode === 'ground' ? clamp(a.pitch, -1.2, 1.2) : 0;
    const share = armed ? 0.3 : 0.14;
    eulerQ(q[B.spine], -pitch * share - this.lean * 0.45, -twist * 0.45, 0);
    eulerQ(q[B.chest], -pitch * share, -twist * 0.55 - sway * 0.6, -sway * 0.3);
    eulerQ(q[B.neck], -pitch * 0.12, 0, 0);
    eulerQ(q[B.head], -pitch * (armed ? 0.28 : 0.5) - this.lean * 0.35 + this.adsT * this.armedT * 0.1, 0, this.adsT * this.armedT * -0.16);

    // chest frame in model space
    _qs.copy(_qh).multiply(q[B.spine]);
    _qc.copy(_qs).multiply(q[B.chest]);
    _pc.set(0, 0.12, 0).applyQuaternion(_qh).add(this.hipPos);
    _pc.add(_v1.set(0, 0.18, 0).applyQuaternion(_qs));
    _qci.copy(_qc).invert();

    // ------------------------------------------------------------- legs
    if (a.mode === 'ground') {
      const len = Math.hypot(a.moveX, a.moveZ) || 1;
      const mx = a.moveX / len;
      const mz = a.moveZ / len;
      const amp = Math.min(0.36, a.speed * 0.07 + 0.06) * mv * (1 - cr * 0.3);
      const liftH = (0.09 + this.sprintT * 0.1) * mv;
      for (const s of [1, -1]) {
        const f = (this.phase + (s > 0 ? 0 : 0.5)) % 1;
        let along: number;
        let lift = 0;
        if (f < 0.5) along = amp * (1 - f * 4);
        else {
          const t = (f - 0.5) * 2;
          along = amp * (-1 + t * 2);
          lift = Math.sin(t * Math.PI) * liftH;
        }
        const stance = 0.095 + cr * 0.06;
        _target.set(s * stance + mx * along, 0.07 + lift, mz * along + cr * 0.06 * s + (1 - mv) * s * -0.03 * this.armedT);
        if (!a.grounded) _target.set(s * 0.1, 0.22 + (s > 0 ? 0.1 : 0), s * 0.1);
        // into hip space
        _target.sub(this.hipPos).applyQuaternion(_q3.copy(_qh).invert());
        _v4.set(s * 0.095, -0.03, 0);
        _pole.set(s * 0.12, 0, 1);
        const ti = s > 0 ? B.thighL : B.thighR;
        solve2(q[ti], q[ti + 1], _v4, _target, _pole, THIGH, SHIN);
        // keep the boot flat on the ground
        q[ti + 2].copy(_qh).multiply(q[ti]).multiply(q[ti + 1]).invert();
        if (lift > 0) q[ti + 2].multiply(_q2.setFromAxisAngle(X_AXIS, lift * 3.2));
      }
    } else if (a.mode === 'freefall') {
      const w = Math.sin(this.idleT * 6) * 0.05;
      eulerQ(q[B.thighL], 0.25 + w, 0, 0.42);
      eulerQ(q[B.thighR], 0.25 - w, 0, -0.42);
      eulerQ(q[B.shinL], 0.95, 0, 0);
      eulerQ(q[B.shinR], 0.95, 0, 0);
    } else if (a.mode === 'chute') {
      const w = Math.sin(this.idleT * 1.3) * 0.08;
      eulerQ(q[B.thighL], -0.35 + w, 0, 0.08);
      eulerQ(q[B.thighR], -0.2 - w, 0, -0.08);
      eulerQ(q[B.shinL], 0.5, 0, 0);
      eulerQ(q[B.shinR], 0.38, 0, 0);
    } else if (a.mode === 'swim') {
      const k = Math.sin(this.idleT * 7);
      eulerQ(q[B.thighL], k * 0.35, 0, 0.05);
      eulerQ(q[B.thighR], -k * 0.35, 0, -0.05);
      eulerQ(q[B.shinL], 0.25 + Math.max(0, -k) * 0.4, 0, 0);
      eulerQ(q[B.shinR], 0.25 + Math.max(0, k) * 0.4, 0, 0);
    } else {
      eulerQ(q[B.thighL], -0.1, 0, 0.16);
      eulerQ(q[B.thighR], -0.42, 0, -0.1);
      eulerQ(q[B.shinL], 0.2, 0, 0);
      eulerQ(q[B.shinR], 0.75, 0, 0);
    }

    // ------------------------------------------------------------- arms
    const wm = this.wm;
    let showWeapon = false;
    this.nadeMesh.visible = false;
    if (a.mode === 'ground' && armed && wm && !busy) {
      showWeapon = true;
      const ads = this.adsT;
      const sp = this.sprintT * (1 - ads);
      const two = wm.twoHanded;
      // weapon pose in model space
      const kick = this.kickT;
      const rel = a.reload >= 0 ? Math.sin(clamp(a.reload, 0, 1) * Math.PI) : 0;
      const aimPitch = -pitch + sp * 0.55 - kick * 0.05 + rel * 0.25;
      eulerQ(_qw, aimPitch, sp * 0.6 + rel * 0.12, rel * -0.35 + sp * 0.25);
      const shoulderY = 1.47 - cr * 0.36 - bob - (HIP_REST - 0.96);
      const ox = two ? lerp(-0.125, -0.045, ads) : lerp(-0.1, -0.035, ads);
      const oy = two ? lerp(-0.1, 0.045, ads) : lerp(-0.06, 0.1, ads);
      const oz = two ? lerp(0.25, 0.2, ads) : lerp(0.42, 0.46, ads);
      _v1.set(ox + sp * 0.06, oy - sp * 0.12, oz - sp * 0.06 - kick * 0.035);
      _v1.applyQuaternion(_q2.setFromAxisAngle(X_AXIS, -pitch));
      _pw.set(0, shoulderY, cr * 0.1 + this.lean * 0.3).add(_v1);
      _pw.y += Math.sin(this.idleT * 1.7) * 0.003 + mv * Math.sin(this.phase * Math.PI * 4) * 0.008;
      // attach to the chest
      this.weaponHolder.position.copy(_pw).sub(_pc).applyQuaternion(_qci);
      this.weaponHolder.quaternion.copy(_qci).multiply(_qw);
      this.muzzle.copy(wm.muzzle).applyQuaternion(_qw).add(_pw);
      // right hand on the grip
      _target.set(0, -0.045, -0.035).applyQuaternion(_qw).add(_pw).sub(_pc).applyQuaternion(_qci);
      _v4.set(-0.2, 0.2, 0);
      _pole.set(-0.7, -1, -0.5);
      solve2(q[B.armR], q[B.foreR], _v4, _target, _pole, UPPER_ARM, FORE_ARM);
      _q3.copy(_qc).multiply(q[B.armR]).multiply(q[B.foreR]).invert();
      q[B.handR].copy(_q3).multiply(_qw).multiply(eulerQ(_q2, -1.35, 0, 0.25));
      // left hand: support, or the magazine during a reload
      _v2.copy(wm.support);
      if (a.reload >= 0) {
        const r = clamp(a.reload, 0, 1);
        const down = r < 0.25 ? r / 0.25 : r < 0.5 ? 1 : r < 0.75 ? 1 - (r - 0.5) / 0.25 : 0;
        const toMag = r < 0.85 ? 1 : 1 - (r - 0.85) / 0.15;
        _v2.lerp(wm.mag, toMag);
        _v2.y -= down * 0.2;
        _v2.z -= down * 0.04;
      }
      _target.copy(_v2).add(_v3.set(two ? 0.015 : 0.03, -0.035, -0.02)).applyQuaternion(_qw).add(_pw).sub(_pc).applyQuaternion(_qci);
      _v4.set(0.2, 0.2, 0);
      _pole.set(0.6, -1, -0.15);
      solve2(q[B.armL], q[B.foreL], _v4, _target, _pole, UPPER_ARM, FORE_ARM);
      _q3.copy(_qc).multiply(q[B.armL]).multiply(q[B.foreL]).invert();
      q[B.handL].copy(_q3).multiply(_qw).multiply(eulerQ(_q2, -1.2, 0, -0.5));
    } else if (a.mode === 'ground') {
      // empty hands: natural swing, or a scripted action
      const sw = Math.sin(this.phase * Math.PI * 2) * mv;
      const run = mv * (0.45 + this.sprintT * 0.5);
      eulerQ(q[B.armL], sw * run * 1.1 + 0.05, 0, 0.1 + cr * 0.1);
      eulerQ(q[B.armR], -sw * run * 1.1 + 0.05, 0, -0.1 - cr * 0.1);
      eulerQ(q[B.foreL], -0.25 - run * 1.3 - cr * 0.6, 0, 0);
      eulerQ(q[B.foreR], -0.25 - run * 1.3 - cr * 0.6, 0, 0);
      if (a.heal >= 0) {
        const w = Math.sin(this.idleT * 9) * 0.03;
        if (a.healKind === 'drink') {
          _target.set(-0.04, 0.34 + w * 0.3, 0.17);
          _v4.set(-0.2, 0.2, 0);
          solve2(q[B.armR], q[B.foreR], _v4, _target, _pole.set(-0.8, -0.6, -0.2), UPPER_ARM, FORE_ARM);
        } else {
          _target.set(0.02, -0.02 + w, 0.26);
          _v4.set(-0.2, 0.2, 0);
          solve2(q[B.armR], q[B.foreR], _v4, _target, _pole.set(-0.8, -1, -0.2), UPPER_ARM, FORE_ARM);
          _target.set(0.1, -0.08 - w, 0.2);
          _v4.set(0.2, 0.2, 0);
          solve2(q[B.armL], q[B.foreL], _v4, _target, _pole.set(0.8, -1, -0.2), UPPER_ARM, FORE_ARM);
        }
      } else if (a.throwing >= 0) {
        const t = clamp(a.throwing, 0, 1);
        this.nadeMesh.visible = t < 0.62;
        if (t < 0.55) _target.set(-0.36, 0.42, -0.22);
        else _target.set(-0.16, 0.3, 0.5).lerp(_v3.set(-0.2, 0.0, 0.42), clamp((t - 0.7) / 0.3, 0, 1));
        _v4.set(-0.2, 0.2, 0);
        solve2(q[B.armR], q[B.foreR], _v4, _target, _pole.set(-1, -0.4, -0.6), UPPER_ARM, FORE_ARM);
        _target.set(0.14, 0.08, 0.38);
        _v4.set(0.2, 0.2, 0);
        solve2(q[B.armL], q[B.foreL], _v4, _target, _pole.set(0.8, -1, -0.2), UPPER_ARM, FORE_ARM);
      } else if (a.punch >= 0) {
        const t = clamp(a.punch, 0, 1);
        const ext = Math.sin(t * Math.PI);
        _target.set(-0.1, 0.12, 0.18 + ext * 0.42);
        _target.applyQuaternion(_q2.setFromAxisAngle(X_AXIS, -pitch));
        _v4.set(-0.2, 0.2, 0);
        solve2(q[B.armR], q[B.foreR], _v4, _target, _pole.set(-0.8, -1, -0.3), UPPER_ARM, FORE_ARM);
        _target.set(0.12, 0.1, 0.24);
        _v4.set(0.2, 0.2, 0);
        solve2(q[B.armL], q[B.foreL], _v4, _target, _pole.set(0.8, -1, -0.2), UPPER_ARM, FORE_ARM);
      }
      this.muzzle.set(-0.12, 1.42 - cr * 0.36, 0.5);
    } else if (a.mode === 'freefall') {
      const w = Math.sin(this.idleT * 5) * 0.06;
      eulerQ(q[B.armL], -0.5, 0, 1.75 + w);
      eulerQ(q[B.armR], -0.5, 0, -1.75 + w);
      eulerQ(q[B.foreL], -0.9, 0, 0);
      eulerQ(q[B.foreR], -0.9, 0, 0);
    } else if (a.mode === 'chute') {
      eulerQ(q[B.armL], 0, 0, 2.75);
      eulerQ(q[B.armR], 0, 0, -2.75);
      eulerQ(q[B.foreL], -0.35, 0, 0);
      eulerQ(q[B.foreR], -0.35, 0, 0);
    } else if (a.mode === 'swim') {
      const s = this.idleT * 3.6;
      eulerQ(q[B.armL], -1.9 + Math.sin(s) * 1.2, 0, 0.3 + Math.cos(s) * 0.35);
      eulerQ(q[B.armR], -1.9 - Math.sin(s) * 1.2, 0, -0.3 + Math.cos(s) * 0.35);
      eulerQ(q[B.foreL], -0.4, 0, 0);
      eulerQ(q[B.foreR], -0.4, 0, 0);
      eulerQ(q[B.head], -0.75, 0, 0);
    } else {
      eulerQ(q[B.armL], -0.2, 0, 0.75);
      eulerQ(q[B.armR], 0.25, 0, -0.5);
      eulerQ(q[B.foreL], -0.5, 0, 0);
      eulerQ(q[B.foreR], -0.9, 0, 0);
      eulerQ(q[B.head], 0.15, 0.5, 0);
    }
    this.weaponMesh.visible = showWeapon;
    this.backMesh.visible = this.curBack !== null;
    this.chuteMesh.visible = a.mode === 'chute';
    if (a.mode === 'chute') this.chuteMesh.rotation.z = Math.sin(this.idleT * 1.1) * 0.05;

    // --------------------------------------------- blend towards targets
    bones[B.hips].position.copy(this.hipPos);
    const k = a.mode === 'dead' ? damp(7, dt) : damp(26, dt);
    const kArm = showWeapon ? damp(38, dt) : k;
    for (let i = 1; i < bones.length; i++) {
      const isArm = i >= B.armL && i <= B.handR;
      bones[i].quaternion.slerp(q[i], isArm ? kArm : k);
    }
  }
}
