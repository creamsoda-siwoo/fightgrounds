import * as THREE from 'three';
import { GeoBuilder } from '../core/GeoBuilder';

/**
 * Hand-built procedural meshes for weapons, armour and pickups. Weapons point
 * down +Z with the origin on the pistol grip so they can be dropped straight
 * into a character's hands.
 */

export interface WeaponModel {
  geo: THREE.BufferGeometry;
  muzzle: THREE.Vector3;
  /** support hand position */
  support: THREE.Vector3;
  /** where the magazine sits (reload animation) */
  mag: THREE.Vector3;
  twoHanded: boolean;
  /** where a mounted optic sits; null for guns with a built-in scope or no rail */
  rail: THREE.Vector3 | null;
}

const M = 'm';
const STEEL = 0x2b2e33;
const DARK = 0x16181b;
const POLY = 0x24272b;
const WOOD = 0x7a4a26;
const WOOD_D = 0x5c3518;
const TAN = 0x8a7a58;
const RX = Math.PI / 2;

function barrelZ(gb: GeoBuilder, x: number, y: number, z0: number, z1: number, r: number, color: number, seg = 10): void {
  gb.cyl(M, x, y, (z0 + z1) / 2, r, r, z1 - z0, color, seg, { rx: RX });
}

function scope(gb: GeoBuilder, y: number, z: number, len: number, r: number): void {
  barrelZ(gb, 0, y, z - len / 2, z + len / 2, r, DARK, 12);
  barrelZ(gb, 0, y, z + len / 2 - 0.01, z + len / 2 + 0.07, r * 1.45, DARK, 12);
  barrelZ(gb, 0, y, z - len / 2 - 0.05, z - len / 2 + 0.01, r * 1.25, DARK, 12);
  barrelZ(gb, 0, y, z + len / 2 + 0.066, z + len / 2 + 0.072, r * 1.3, 0x3a6a9a, 12);
  barrelZ(gb, 0, y, z - len / 2 - 0.052, z - len / 2 - 0.046, r * 1.1, 0x2a4a6a, 12);
  gb.cyl(M, 0, y + r + 0.012, z, 0.012, 0.012, 0.024, STEEL, 8);
  gb.cyl(M, -r - 0.012, y, z, 0.012, 0.012, 0.024, STEEL, 8, { rz: RX });
  for (const dz of [-len * 0.28, len * 0.28]) {
    gb.box(M, 0, y - r - 0.012, z + dz, 0.028, 0.03, 0.022, STEEL);
    gb.box(M, 0, y, z + dz, r * 2 + 0.012, r * 2 + 0.012, 0.016, STEEL);
  }
}

function build(fn: (gb: GeoBuilder) => void, muzzle: [number, number, number], support: [number, number, number], mag: [number, number, number], twoHanded = true, rail: [number, number, number] | null = null): WeaponModel {
  const gb = new GeoBuilder();
  fn(gb);
  return {
    geo: gb.build()[M],
    muzzle: new THREE.Vector3(...muzzle),
    support: new THREE.Vector3(...support),
    mag: new THREE.Vector3(...mag),
    twoHanded,
    rail: rail ? new THREE.Vector3(...rail) : null,
  };
}

function makeKestrel(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.038, 0.06, 0.046, 0.072, 0.24, STEEL);
    gb.box(M, 0, 0.082, 0.14, 0.03, 0.014, 0.4, DARK);
    for (let k = 0; k < 14; k++) gb.box(M, 0, 0.091, -0.04 + k * 0.027, 0.032, 0.006, 0.012, STEEL);
    // handguard with ventilation slots
    gb.box(M, 0, 0.04, 0.31, 0.05, 0.056, 0.26, POLY);
    for (let k = 0; k < 5; k++) for (const sx of [-1, 1]) gb.box(M, sx * 0.026, 0.045, 0.22 + k * 0.045, 0.004, 0.018, 0.028, 0x0c0d0f);
    gb.box(M, 0, 0.008, 0.31, 0.03, 0.01, 0.24, DARK);
    barrelZ(gb, 0, 0.04, 0.42, 0.6, 0.0095, STEEL);
    barrelZ(gb, 0, 0.04, 0.6, 0.66, 0.015, DARK, 8);
    gb.box(M, 0, 0.04, 0.63, 0.034, 0.008, 0.036, 0x0c0d0f);
    gb.box(M, 0, 0.066, 0.47, 0.022, 0.03, 0.03, STEEL);
    // magazine, grip, trigger guard
    gb.box(M, 0, -0.075, 0.105, 0.026, 0.17, 0.06, 0x30343a, { rx: 0.14 });
    gb.box(M, 0, -0.156, 0.117, 0.03, 0.014, 0.066, DARK, { rx: 0.14 });
    gb.box(M, 0, -0.062, -0.02, 0.032, 0.105, 0.044, POLY, { rx: -0.28 });
    gb.box(M, 0, -0.022, 0.04, 0.008, 0.006, 0.07, STEEL);
    gb.box(M, 0, -0.008, 0.035, 0.006, 0.026, 0.008, DARK, { rx: 0.3 });
    // stock
    barrelZ(gb, 0, 0.05, -0.26, -0.06, 0.015, STEEL);
    gb.box(M, 0, 0.03, -0.25, 0.04, 0.11, 0.14, POLY);
    gb.box(M, 0, 0.068, -0.24, 0.036, 0.022, 0.12, DARK);
    gb.box(M, 0, 0.022, -0.325, 0.044, 0.13, 0.016, 0x0c0d0f);
    // iron sights
    gb.box(M, 0, 0.104, -0.04, 0.026, 0.026, 0.014, DARK);
    gb.box(M, 0, 0.108, 0.47, 0.012, 0.034, 0.012, DARK);
    // ejection port, forward assist
    gb.box(M, -0.024, 0.05, 0.07, 0.003, 0.02, 0.06, 0x0c0d0f);
    gb.cyl(M, -0.028, 0.05, -0.02, 0.008, 0.008, 0.012, DARK, 6, { rz: RX });
  }, [0, 0.04, 0.67], [0, -0.005, 0.3], [0, -0.09, 0.105], true, [0, 0.097, 0.07]);
}

function makeBulwark(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.034, 0.05, 0.044, 0.066, 0.27, STEEL);
    gb.box(M, 0, 0.072, 0.04, 0.04, 0.014, 0.22, DARK);
    // wood furniture
    gb.box(M, 0, 0.03, 0.3, 0.048, 0.052, 0.2, WOOD);
    gb.box(M, 0, 0.068, 0.29, 0.036, 0.026, 0.17, WOOD_D);
    for (const sx of [-1, 1]) gb.box(M, sx * 0.025, 0.034, 0.3, 0.003, 0.012, 0.14, WOOD_D);
    barrelZ(gb, 0, 0.074, 0.19, 0.44, 0.011, STEEL);
    barrelZ(gb, 0, 0.04, 0.4, 0.64, 0.0095, STEEL);
    gb.box(M, 0, 0.062, 0.45, 0.02, 0.05, 0.03, STEEL);
    gb.box(M, 0, 0.074, 0.6, 0.014, 0.06, 0.018, STEEL);
    for (const sx of [-1, 1]) gb.box(M, sx * 0.012, 0.1, 0.6, 0.004, 0.02, 0.018, STEEL);
    barrelZ(gb, 0, 0.04, 0.64, 0.685, 0.013, DARK, 8);
    // banana magazine
    gb.box(M, 0, -0.04, 0.115, 0.026, 0.08, 0.062, 0x3a3128, { rx: 0.12 });
    gb.box(M, 0, -0.105, 0.135, 0.026, 0.075, 0.06, 0x3a3128, { rx: 0.42 });
    gb.box(M, 0, -0.155, 0.168, 0.026, 0.06, 0.058, 0x3a3128, { rx: 0.72 });
    // grip + guard
    gb.box(M, 0, -0.06, -0.025, 0.032, 0.105, 0.042, WOOD, { rx: -0.3 });
    gb.box(M, 0, -0.022, 0.035, 0.008, 0.006, 0.075, STEEL);
    gb.box(M, 0, -0.008, 0.032, 0.006, 0.026, 0.008, DARK, { rx: 0.3 });
    // stock
    gb.box(M, 0, 0.012, -0.2, 0.04, 0.085, 0.24, WOOD, { rx: 0.09 });
    gb.box(M, 0, -0.008, -0.315, 0.042, 0.12, 0.02, 0x1c1c1c, { rx: 0.09 });
    // rear sight, charging handle
    gb.box(M, 0, 0.088, 0.14, 0.02, 0.014, 0.06, DARK);
    gb.cyl(M, -0.03, 0.05, 0.08, 0.006, 0.006, 0.03, STEEL, 6, { rz: RX });
    gb.box(M, -0.023, 0.046, 0.04, 0.003, 0.016, 0.12, 0x0c0d0f);
  }, [0, 0.04, 0.69], [0, -0.008, 0.3], [0, -0.09, 0.13], true, [0, 0.079, 0.06]);
}

function makeHornet(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.04, 0.08, 0.05, 0.08, 0.3, POLY);
    gb.box(M, 0, 0.086, 0.08, 0.032, 0.012, 0.28, DARK);
    for (let k = 0; k < 9; k++) gb.box(M, 0, 0.094, -0.03 + k * 0.028, 0.034, 0.005, 0.012, STEEL);
    barrelZ(gb, 0, 0.04, 0.23, 0.36, 0.019, STEEL, 10);
    for (let k = 0; k < 4; k++) gb.box(M, 0, 0.04, 0.25 + k * 0.028, 0.042, 0.01, 0.012, 0x0c0d0f);
    barrelZ(gb, 0, 0.04, 0.36, 0.42, 0.009, DARK, 8);
    gb.box(M, 0, -0.1, 0.11, 0.024, 0.22, 0.036, 0x30343a);
    gb.box(M, 0, -0.06, -0.02, 0.032, 0.1, 0.042, POLY, { rx: -0.22 });
    gb.box(M, 0, -0.045, 0.2, 0.028, 0.09, 0.03, POLY, { rx: 0.1 });
    gb.box(M, 0, -0.02, 0.045, 0.008, 0.006, 0.07, STEEL);
    // skeleton stock
    for (const sy of [0.066, 0.006]) barrelZ(gb, 0, sy, -0.3, -0.07, 0.006, STEEL, 6);
    gb.box(M, 0, 0.036, -0.305, 0.03, 0.1, 0.014, 0x0c0d0f);
    gb.box(M, 0, 0.11, -0.04, 0.012, 0.03, 0.012, DARK);
    gb.box(M, 0, 0.108, 0.2, 0.008, 0.026, 0.01, DARK);
  }, [0, 0.04, 0.43], [0, -0.05, 0.2], [0, -0.1, 0.11], true, [0, 0.1, 0.07]);
}

function makeViper(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.05, 0.05, 0.028, 0.036, 0.19, STEEL);
    for (let k = 0; k < 6; k++) gb.box(M, 0, 0.05, -0.035 + k * 0.008, 0.03, 0.03, 0.003, 0x0c0d0f);
    gb.box(M, 0, 0.024, 0.045, 0.026, 0.022, 0.16, POLY);
    gb.box(M, 0, -0.04, -0.012, 0.027, 0.11, 0.048, POLY, { rx: -0.2 });
    gb.box(M, 0, -0.096, -0.024, 0.03, 0.012, 0.052, DARK, { rx: -0.2 });
    gb.box(M, 0, 0.002, 0.05, 0.007, 0.006, 0.06, POLY);
    gb.box(M, 0, 0.012, 0.08, 0.007, 0.024, 0.007, POLY);
    barrelZ(gb, 0, 0.052, 0.14, 0.152, 0.007, 0x0c0d0f, 8);
    gb.box(M, 0, 0.072, 0.135, 0.005, 0.008, 0.008, DARK);
    gb.box(M, 0, 0.072, -0.035, 0.018, 0.008, 0.008, DARK);
  }, [0, 0.052, 0.155], [0.012, -0.035, 0.0], [0, -0.06, -0.015], false);
}

function makeThunder(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.04, 0.06, 0.044, 0.07, 0.26, STEEL);
    barrelZ(gb, 0, 0.056, 0.19, 0.78, 0.0125, STEEL, 10);
    barrelZ(gb, 0, 0.026, 0.19, 0.62, 0.0125, DARK, 10);
    gb.box(M, 0, 0.042, 0.6, 0.012, 0.05, 0.02, STEEL);
    // pump
    barrelZ(gb, 0, 0.026, 0.3, 0.5, 0.026, WOOD, 10);
    for (let k = 0; k < 6; k++) barrelZ(gb, 0, 0.026, 0.315 + k * 0.03, 0.325 + k * 0.03, 0.0275, WOOD_D, 10);
    // stock with integrated grip
    gb.box(M, 0, -0.03, -0.035, 0.036, 0.09, 0.05, WOOD, { rx: -0.5 });
    gb.box(M, 0, 0.0, -0.21, 0.04, 0.095, 0.26, WOOD, { rx: 0.12 });
    gb.box(M, 0, -0.025, -0.335, 0.042, 0.125, 0.022, 0x1c1c1c, { rx: 0.12 });
    gb.box(M, 0, -0.018, 0.045, 0.008, 0.006, 0.075, STEEL);
    gb.box(M, 0, 0.074, 0.775, 0.006, 0.012, 0.006, 0xc9a020);
    gb.box(M, -0.023, 0.046, 0.08, 0.003, 0.02, 0.07, 0x0c0d0f);
  }, [0, 0.056, 0.79], [0, 0.0, 0.4], [0, 0.0, 0.2], true, [0, 0.076, 0.06]);
}

function makeRanger(): WeaponModel {
  return build((gb) => {
    gb.box(M, 0, 0.038, 0.07, 0.048, 0.074, 0.28, TAN);
    gb.box(M, 0, 0.082, 0.16, 0.03, 0.014, 0.46, DARK);
    gb.box(M, 0, 0.04, 0.36, 0.05, 0.054, 0.32, TAN);
    for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) gb.box(M, sx * 0.026, 0.044, 0.24 + k * 0.048, 0.004, 0.016, 0.03, 0x0c0d0f);
    barrelZ(gb, 0, 0.04, 0.5, 0.78, 0.0105, STEEL);
    barrelZ(gb, 0, 0.04, 0.78, 0.85, 0.016, DARK, 8);
    for (let k = 0; k < 3; k++) gb.box(M, 0, 0.04, 0.795 + k * 0.018, 0.036, 0.007, 0.008, 0x0c0d0f);
    gb.box(M, 0, -0.06, 0.12, 0.028, 0.13, 0.07, 0x30343a, { rx: 0.08 });
    gb.box(M, 0, -0.064, -0.02, 0.032, 0.108, 0.044, POLY, { rx: -0.26 });
    gb.box(M, 0, -0.022, 0.04, 0.008, 0.006, 0.07, STEEL);
    // precision stock with cheek riser
    gb.box(M, 0, 0.02, -0.2, 0.04, 0.09, 0.24, TAN);
    gb.box(M, 0, 0.078, -0.18, 0.036, 0.03, 0.14, DARK);
    gb.box(M, 0, 0.012, -0.33, 0.044, 0.13, 0.02, 0x0c0d0f);
    gb.box(M, 0, -0.03, -0.24, 0.03, 0.03, 0.12, TAN);
    scope(gb, 0.125, 0.09, 0.2, 0.019);
    // folded bipod
    for (const sx of [-1, 1]) barrelZ(gb, sx * 0.018, 0.0, 0.34, 0.52, 0.005, STEEL, 6);
  }, [0, 0.04, 0.86], [0, -0.006, 0.32], [0, -0.07, 0.12]);
}

function makeLongbow(): WeaponModel {
  return build((gb) => {
    // one-piece stock
    gb.box(M, 0, 0.012, 0.2, 0.048, 0.05, 0.5, 0x3d4a32);
    gb.box(M, 0, 0.0, -0.16, 0.044, 0.085, 0.28, 0x3d4a32, { rx: 0.07 });
    gb.box(M, 0, 0.062, -0.17, 0.038, 0.03, 0.15, 0x2c3624);
    gb.box(M, 0, -0.02, -0.305, 0.046, 0.13, 0.022, 0x0c0d0f, { rx: 0.07 });
    gb.box(M, 0, -0.05, -0.02, 0.034, 0.09, 0.046, 0x3d4a32, { rx: -0.34 });
    // action
    barrelZ(gb, 0, 0.056, -0.06, 0.24, 0.02, STEEL, 12);
    barrelZ(gb, 0, 0.056, 0.24, 0.92, 0.0115, STEEL, 10);
    barrelZ(gb, 0, 0.056, 0.92, 1.0, 0.018, DARK, 10);
    for (let k = 0; k < 4; k++) gb.box(M, 0, 0.056, 0.935 + k * 0.016, 0.04, 0.007, 0.007, 0x0c0d0f);
    // bolt
    gb.cyl(M, -0.035, 0.05, -0.03, 0.006, 0.006, 0.05, STEEL, 6, { rz: RX * 0.7 });
    gb.sphere(M, -0.058, 0.036, -0.03, 0.013, DARK);
    gb.box(M, 0, -0.03, 0.09, 0.03, 0.05, 0.085, 0x1c1e21);
    gb.box(M, 0, -0.02, 0.03, 0.008, 0.006, 0.075, STEEL);
    scope(gb, 0.122, 0.09, 0.3, 0.023);
    for (const sx of [-1, 1]) barrelZ(gb, sx * 0.02, -0.014, 0.36, 0.56, 0.005, STEEL, 6);
  }, [0, 0.056, 1.01], [0, -0.012, 0.34], [0, -0.04, 0.09]);
}

/** optics are built sitting on y = 0 (the rail), looking down +Z */
function makeScope(mag: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  // rail clamp
  gb.box(M, 0, 0.008, 0, 0.032, 0.016, mag >= 4 ? 0.1 : 0.06, DARK);
  if (mag === 1) {
    gb.box(M, 0, 0.03, 0, 0.036, 0.03, 0.05, STEEL);
    gb.box(M, 0, 0.056, 0.012, 0.036, 0.022, 0.012, STEEL);
    for (const sx of [-1, 1]) gb.box(M, sx * 0.017, 0.056, -0.004, 0.004, 0.026, 0.044, STEEL);
    gb.box(M, 0, 0.054, 0.006, 0.028, 0.02, 0.002, 0x7a2a2a);
    gb.box(M, 0.02, 0.03, -0.01, 0.008, 0.012, 0.012, 0x15171a);
  } else {
    const r = mag === 2 ? 0.016 : mag === 4 ? 0.019 : 0.023;
    const len = mag === 2 ? 0.09 : mag === 4 ? 0.16 : 0.26;
    scope(gb, 0.02 + r, 0, len, r);
    if (mag === 8) for (const sx of [-1, 1]) gb.cyl(M, sx * (r + 0.008), 0.02 + r, 0.02, 0.009, 0.009, 0.016, 0x8a8f96, 8, { rz: RX });
  }
  return gb.build()[M];
}

function makeGrenade(): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  gb.sphere(M, 0, 0, 0, 0.045, 0x3f4a2e, 1, 1.18, 1, 10);
  for (let k = -1; k <= 1; k++) gb.cyl(M, 0, k * 0.02, 0, 0.047, 0.047, 0.004, 0x2c3420, 10);
  gb.cyl(M, 0, 0.06, 0, 0.016, 0.02, 0.03, 0x8a8f96, 8);
  gb.box(M, 0.02, 0.045, 0, 0.008, 0.07, 0.016, 0x9a9fa6, { rz: -0.25 });
  gb.cyl(M, -0.024, 0.07, 0, 0.014, 0.014, 0.003, 0xc9c9c9, 8, { rx: RX });
  return gb.build()[M];
}

export interface GearSet {
  helmet: THREE.BufferGeometry[];
  vest: THREE.BufferGeometry[];
}

/** helmets are modelled around the head bone origin, vests around the chest bone */
function makeHelmet(level: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  const col = [0, 0x7a7350, 0x3d4a36, 0x202327][level];
  const dome = new THREE.SphereGeometry(0.128, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.118, 0.008), new THREE.Quaternion(), new THREE.Vector3(1.0, 1.02, 1.12));
  gb.geo(M, dome, col, m);
  gb.cyl(M, 0, 0.098, 0.008, 0.131, 0.133, 0.022, col, 16);
  if (level >= 1) {
    // chin strap + side mounts
    for (const sx of [-1, 1]) gb.box(M, sx * 0.105, 0.04, 0.02, 0.008, 0.11, 0.016, 0x1a1a1a);
    gb.box(M, 0, -0.012, 0.06, 0.2, 0.012, 0.016, 0x1a1a1a);
  }
  if (level === 1) {
    gb.box(M, 0, 0.112, 0.14, 0.2, 0.014, 0.07, col, { rx: 0.25 });
  }
  if (level >= 2) {
    for (const sx of [-1, 1]) {
      gb.box(M, sx * 0.132, 0.13, 0.0, 0.014, 0.03, 0.09, 0x15171a);
      gb.box(M, sx * 0.118, 0.07, -0.01, 0.03, 0.08, 0.1, col);
    }
    // goggles on the brow
    gb.box(M, 0, 0.165, 0.128, 0.17, 0.05, 0.03, 0x15171a, { rx: -0.25 });
    gb.box(M, 0, 0.167, 0.142, 0.15, 0.036, 0.006, 0x3a5a6a, { rx: -0.25 });
    gb.box(M, 0, 0.2, 0.1, 0.05, 0.03, 0.03, 0x15171a);
  }
  if (level >= 3) {
    // face shield and neck guard
    gb.box(M, 0, 0.09, 0.136, 0.2, 0.09, 0.01, 0x2a3a44, { rx: 0.08 });
    gb.box(M, 0, 0.04, -0.1, 0.2, 0.1, 0.03, col, { rx: 0.2 });
    gb.box(M, 0, 0.02, 0.1, 0.16, 0.06, 0.06, col);
    gb.cyl(M, 0, 0.245, 0.0, 0.012, 0.012, 0.02, 0x8a8f96, 6);
  }
  return gb.build()[M];
}

function makeVest(level: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  const col = [0, 0x2c3646, 0x4c5538, 0x25282c][level];
  const dk = [0, 0x1e2632, 0x363d28, 0x15171a][level];
  const t = 0.03 + level * 0.012;
  // plates
  gb.box(M, 0, 0.03, 0.115 + t / 2, 0.3, 0.36, t, col, { rx: -0.05 });
  gb.box(M, 0, 0.03, -0.115 - t / 2, 0.31, 0.38, t, col, { rx: 0.03 });
  for (const sx of [-1, 1]) {
    gb.box(M, sx * 0.175, -0.04, 0, 0.03, 0.2, 0.22, dk);
    gb.box(M, sx * 0.105, 0.225, 0, 0.07, 0.03, 0.26, dk);
  }
  // pouches
  const n = level + 1;
  for (let k = 0; k < n; k++) {
    const px = (k - (n - 1) / 2) * 0.078;
    gb.box(M, px, -0.07, 0.14 + t, 0.066, 0.13, 0.04, dk);
    gb.box(M, px, -0.012, 0.145 + t, 0.068, 0.02, 0.044, col);
  }
  gb.box(M, 0.09, 0.12, 0.125 + t, 0.08, 0.05, 0.02, dk);
  if (level >= 2) {
    gb.box(M, -0.1, 0.11, 0.135 + t, 0.05, 0.1, 0.035, 0x15171a);
    gb.cyl(M, -0.1, 0.2, 0.13 + t, 0.006, 0.006, 0.09, 0x15171a, 5);
    gb.box(M, 0, 0.0, -0.15 - t, 0.22, 0.2, 0.03, dk);
  }
  if (level >= 3) {
    for (const sx of [-1, 1]) gb.box(M, sx * 0.215, 0.19, 0, 0.12, 0.05, 0.17, col, { rz: sx * -0.35 });
    gb.box(M, 0, 0.235, 0.085, 0.16, 0.06, 0.03, col, { rx: -0.3 });
    gb.box(M, 0, 0.235, -0.09, 0.2, 0.07, 0.03, col, { rx: 0.25 });
    gb.box(M, 0, -0.2, 0.12, 0.2, 0.12, 0.03, col, { rx: 0.1 });
  }
  return gb.build()[M];
}

function makeAmmoBox(stripe: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(M, 0, 0.055, 0, 0.2, 0.11, 0.12, 0x4f5a3c);
  gb.box(M, 0, 0.115, 0, 0.205, 0.012, 0.125, 0x3c4630);
  gb.box(M, 0, 0.06, 0.061, 0.14, 0.04, 0.003, stripe);
  gb.box(M, 0, 0.06, -0.061, 0.14, 0.04, 0.003, stripe);
  gb.box(M, 0, 0.135, 0, 0.1, 0.008, 0.016, 0x1c1c1c);
  for (const sx of [-1, 1]) gb.box(M, sx * 0.102, 0.08, 0, 0.006, 0.03, 0.05, 0x8a8f96);
  return gb.build()[M];
}
function makeMedkit(): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  gb.box(M, 0, 0.07, 0, 0.26, 0.14, 0.18, 0xe9e6e0);
  gb.box(M, 0, 0.07, 0, 0.262, 0.012, 0.182, 0x9a9a9a);
  for (const sz of [0.091, -0.091]) {
    gb.box(M, 0, 0.07, sz, 0.09, 0.03, 0.002, 0xc8281e);
    gb.box(M, 0, 0.07, sz, 0.03, 0.09, 0.002, 0xc8281e);
  }
  gb.box(M, 0, 0.15, 0, 0.1, 0.014, 0.02, 0x3a3a3a);
  return gb.build()[M];
}
function makeBandage(): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  gb.cyl(M, 0, 0.04, 0, 0.04, 0.04, 0.07, 0xf0ece2, 12, { rz: RX });
  gb.cyl(M, 0, 0.04, 0, 0.015, 0.015, 0.072, 0xc9c2b2, 8, { rz: RX });
  gb.cyl(M, 0.09, 0.04, 0.02, 0.04, 0.04, 0.07, 0xf0ece2, 12, { rz: RX, ry: 0.5 });
  gb.box(M, -0.02, 0.006, 0.06, 0.07, 0.004, 0.09, 0xf0ece2, { ry: 0.3 });
  return gb.build()[M];
}
function makeDrink(): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  gb.cyl(M, 0, 0.065, 0, 0.03, 0.03, 0.13, 0x1e7ad0, 12);
  gb.cyl(M, 0, 0.065, 0, 0.0305, 0.0305, 0.05, 0xf2c21a, 12);
  gb.cyl(M, 0, 0.132, 0, 0.026, 0.03, 0.006, 0xc9c9c9, 12);
  gb.cyl(M, 0, 0.002, 0, 0.03, 0.026, 0.006, 0xc9c9c9, 12);
  return gb.build()[M];
}

function makeChute(): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  const seg = 12;
  const R = 2.7;
  const cols = [0xd9482e, 0xf2efe6];
  // canopy gores
  for (let k = 0; k < seg; k++) {
    const g = new THREE.SphereGeometry(R, 3, 6, (k / seg) * Math.PI * 2, (Math.PI * 2) / seg, 0, Math.PI * 0.42);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 5.2 - R * 0.62, 0), new THREE.Quaternion(), new THREE.Vector3(1, 0.62, 1));
    gb.geo(M, g, cols[k % 2], m);
    const a = ((k + 0.5) / seg) * Math.PI * 2;
    const ex = Math.cos(a) * R * 0.96;
    const ez = Math.sin(a) * R * 0.96;
    const ey = 5.2 - R * 0.62 + R * 0.62 * Math.cos(Math.PI * 0.42);
    // suspension line down to the harness
    const from = new THREE.Vector3(ex, ey, ez);
    const to = new THREE.Vector3(Math.sign(ex) * 0.18, 1.55, 0);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    const lg = new THREE.CylinderGeometry(0.008, 0.008, len, 3, 1);
    gb.geo(M, lg, 0xdcd8cc, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  }
  return gb.build()[M];
}

export interface ModelLibrary {
  weapons: Record<string, WeaponModel>;
  grenade: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry[];
  vest: THREE.BufferGeometry[];
  ammo: Record<string, THREE.BufferGeometry>;
  scopes: Record<number, THREE.BufferGeometry>;
  medkit: THREE.BufferGeometry;
  bandage: THREE.BufferGeometry;
  drink: THREE.BufferGeometry;
  chute: THREE.BufferGeometry;
  gearMat: THREE.MeshStandardMaterial;
  weaponMat: THREE.MeshStandardMaterial;
  chuteMat: THREE.MeshStandardMaterial;
}

let lib: ModelLibrary | null = null;

export function getModels(): ModelLibrary {
  if (lib) return lib;
  lib = {
    weapons: {
      kestrel: makeKestrel(),
      bulwark: makeBulwark(),
      hornet: makeHornet(),
      viper: makeViper(),
      thunder: makeThunder(),
      ranger: makeRanger(),
      longbow: makeLongbow(),
    },
    grenade: makeGrenade(),
    helmet: [new THREE.BufferGeometry(), makeHelmet(1), makeHelmet(2), makeHelmet(3)],
    vest: [new THREE.BufferGeometry(), makeVest(1), makeVest(2), makeVest(3)],
    ammo: {
      '9mm': makeAmmoBox(0xd9a520),
      '5.56': makeAmmoBox(0x3a8a4a),
      '7.62': makeAmmoBox(0xb0472e),
      '12g': makeAmmoBox(0x8a3ab0),
    },
    scopes: { 1: makeScope(1), 2: makeScope(2), 4: makeScope(4), 8: makeScope(8) },
    medkit: makeMedkit(),
    bandage: makeBandage(),
    drink: makeDrink(),
    chute: makeChute(),
    gearMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }),
    weaponMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.55 }),
    chuteMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  };
  return lib;
}
