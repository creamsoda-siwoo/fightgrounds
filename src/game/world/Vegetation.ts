import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND_RADIUS, WORLD_HALF, WORLD_SIZE, type QualityPreset } from '../config';
import { Noise2D, mulberry32, rrange, type Rng } from '../core/math';
import type { TextureSet } from '../core/textures';
import { SURF_ROCK, SURF_WOOD, type ColliderWorld } from './Colliders';
import type { Terrain } from './Terrain';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

interface Part {
  g: THREE.BufferGeometry;
  color: (y01: number, n: THREE.Vector3, v: THREE.Vector3) => [number, number, number];
  sway: (v: THREE.Vector3) => number;
  /** scale applied to the geometry's own UVs (planar fallback when absent) */
  uvScale?: [number, number];
}

/** merge parts into a single geometry with color + sway attributes */
function assemble(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const part of parts) {
    const g = part.g;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const p = g.getAttribute('position');
    const nr = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      n.fromBufferAttribute(nr, i);
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      const y01 = (v.y - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y);
      const c = part.color(y01, n, v);
      _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      col.push(_c.r, _c.g, _c.b);
      sway.push(part.sway(v));
      if (u && part.uvScale) uv.push(u.getX(i) * part.uvScale[0], u.getY(i) * part.uvScale[1]);
      else uv.push((v.x * 0.6 + v.z * 0.8) * 0.42, v.y * 0.42 + (v.x * 0.3 - v.z * 0.2) * 0.2);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function blob(r: number, detail: number, noise: Noise2D, seed: number, squash = 0.8): THREE.BufferGeometry {
  // non-indexed so the built-in seam-free UVs survive; identical directions
  // displace identically, which keeps the surface watertight
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    const d = 1 + noise.noise(n.x * 1.3 + seed, n.y * 1.3 + n.z * 1.1 - seed) * 0.3 + noise.noise(n.x * 3.1 - seed, n.z * 3.1 + n.y * 2.7) * 0.12;
    v.copy(n).multiplyScalar(r * d);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
    n.y *= 1.15;
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function pineGeometry(rng: Rng, noise: Noise2D, lo = false): THREE.BufferGeometry {
  const H = 9.5;
  const parts: Part[] = [];
  const trunk = new THREE.CylinderGeometry(0.07, 0.3, H * 0.96, lo ? 5 : 7, lo ? 1 : 3).translate(0, H * 0.48, 0);
  parts.push({
    g: trunk,
    color: (_y, _n, v) => {
      const k = 0.85 + noise.noise(v.y * 2, v.x * 9) * 0.15;
      return [0.3 * k, 0.21 * k, 0.15 * k];
    },
    sway: (v) => Math.pow(v.y / H, 2) * 0.5,
  });
  const tiers = 7;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const rot = rng() * 6.28;
    const shade = 0.82 + rng() * 0.3;
    // the distant version keeps every other tier and stretches it to fill the gap
    if (lo && k % 2 === 1) continue;
    const r = THREE.MathUtils.lerp(2.5, 0.55, Math.pow(t, 0.85)) * (lo ? 1.06 : 1);
    const h = THREE.MathUtils.lerp(2.6, 1.5, t) * (lo ? 1.55 : 1);
    const y = H * (0.24 + 0.64 * t) + (lo ? 0.35 : 0);
    const seg = lo ? 7 : 11;
    const g = new THREE.ConeGeometry(r, h, seg, lo ? 1 : 2, true);
    const p = g.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const ang = Math.atan2(v.z, v.x);
      const rad = Math.hypot(v.x, v.z);
      const frac = (v.y + h / 2) / h; // 0 bottom
      const jag = 0.78 + 0.22 * Math.cos(ang * 5.5 + rot + k) + noise.noise(ang * 2 + k * 7, v.y) * 0.12;
      const nr = rad * (frac < 0.6 ? jag : 1);
      const droop = (1 - frac) * (1 - frac) * 0.5 * (rad / r);
      p.setXYZ(i, Math.cos(ang + rot * 0.1) * nr, v.y - droop + y, Math.sin(ang + rot * 0.1) * nr);
    }
    g.computeVertexNormals();
    parts.push({
      g,
      color: (y01, n) => {
        const light = 0.5 + 0.5 * y01 + Math.max(0, n.y) * 0.2;
        return [0.17 * light * shade, 0.31 * light * shade, 0.18 * light * shade];
      },
      sway: (v) => Math.pow(v.y / H, 2) * (0.6 + 0.4 * Math.min(1, Math.hypot(v.x, v.z) / 2)),
      uvScale: [4, 1.2],
    });
  }
  return assemble(parts);
}

function broadleafGeometry(rng: Rng, noise: Noise2D, big: boolean, lo = false): THREE.BufferGeometry {
  const H = big ? 7.5 : 5.5;
  const parts: Part[] = [];
  const trunkH = H * 0.6;
  const trunk = new THREE.CylinderGeometry(big ? 0.2 : 0.13, big ? 0.42 : 0.26, trunkH, lo ? 5 : 8, lo ? 2 : 4).translate(0, trunkH / 2, 0);
  {
    const p = trunk.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const bend = Math.pow(v.y / trunkH, 2);
      p.setXYZ(i, v.x + bend * 0.3 + noise.noise(v.y * 0.8, 3) * 0.08, v.y, v.z + bend * -0.15);
    }
    trunk.computeVertexNormals();
  }
  const bark = (_y: number, _n: THREE.Vector3, v: THREE.Vector3): [number, number, number] => {
    const k = 0.8 + noise.noise(v.y * 3, v.x * 11 + v.z * 7) * 0.2;
    return [0.36 * k, 0.28 * k, 0.2 * k];
  };
  parts.push({ g: trunk, color: bark, sway: (v) => Math.pow(v.y / H, 2) * 0.3 });
  const blobs = big ? 6 : 5;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + rng();
    const rr = k === 0 ? 0 : rrange(rng, 0.9, big ? 2.1 : 1.5);
    const cy = trunkH + rrange(rng, -0.2, big ? 2.2 : 1.6) + (k === 0 ? 1.2 : 0);
    const r = rrange(rng, big ? 1.5 : 1.1, big ? 2.2 : 1.6) * (k === 0 ? 1.15 : 1);
    const cx = Math.cos(a) * rr + 0.3;
    const cz = Math.sin(a) * rr - 0.15;
    // branch
    if (k > 0 && k % 2 === 0 && !lo) {
      const len = Math.hypot(cx, cy - trunkH * 0.7, cz);
      const br = new THREE.CylinderGeometry(0.05, 0.11, len, 5, 1).translate(0, len / 2, 0);
      const dir = new THREE.Vector3(cx, cy - trunkH * 0.7, cz).normalize();
      br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      br.translate(0.15, trunkH * 0.7, 0);
      parts.push({ g: br, color: bark, sway: (v) => Math.pow(v.y / H, 2) * 0.5 });
    }
    const seed = k * 13.7 + rng() * 50;
    const tint = rrange(rng, 0.85, 1.2);
    const warm = rng() * 0.12;
    // distant trees keep only their four largest masses
    if (lo && k >= 4) continue;
    const g = blob(lo ? r * 1.12 : r, lo ? 1 : k < 3 ? 2 : 1, noise, seed, 0.78).translate(cx, cy, cz);
    parts.push({
      g,
      color: (y01, n) => {
        const light = (0.42 + 0.62 * y01) * (0.86 + Math.max(0, n.y) * 0.22);
        return [(0.27 + warm) * light * tint, 0.42 * light * tint, 0.16 * light * tint];
      },
      sway: (v) => 0.35 + Math.pow(Math.max(0, v.y / H), 2) * 0.65,
      uvScale: [4, 2],
    });
  }
  return assemble(parts);
}

function bushGeometry(rng: Rng, noise: Noise2D, lo = false): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let k = 0; k < 4; k++) {
    const a = rng() * 6.28;
    const rr = k === 0 ? 0 : rrange(rng, 0.4, 0.8);
    const r = rrange(rng, 0.55, 0.85) * (lo ? 1.2 : 1);
    const seed = k * 5.1 + rng() * 30;
    const tint = rrange(rng, 0.8, 1.15);
    if (lo && k >= 2) continue;
    const g = blob(r, lo ? 0 : 1, noise, seed, 0.75).translate(Math.cos(a) * rr, r * 0.6, Math.sin(a) * rr);
    parts.push({
      g,
      color: (y01, n) => {
        const light = (0.4 + 0.6 * y01) * (0.85 + Math.max(0, n.y) * 0.2);
        return [0.28 * light * tint, 0.4 * light * tint, 0.17 * light * tint];
      },
      sway: (v) => Math.min(1, v.y) * 0.25,
      uvScale: [2.5, 1.25],
    });
  }
  return assemble(parts);
}

function rockGeometry(noise: Noise2D, seed: number, lo = false): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, lo ? 1 : 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-3);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  const uv: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1 + noise.noise(v.x * 1.1 + seed, v.y * 1.1 + v.z * 0.9) * 0.34 + noise.noise(v.x * 2.9 - seed, v.z * 2.9 + v.y * 2.3) * 0.12;
    // chisel a few flat faces
    const f = v.x * 0.6 + v.y * 0.3 + v.z * 0.74;
    if (f > 0.72) d *= 0.72 / f;
    v.multiplyScalar(d);
    v.y = Math.max(v.y, -0.45);
    p.setXYZ(i, v.x, v.y, v.z);
    uv.push(v.x * 0.5 + v.z * 0.35, v.y * 0.5 + v.z * 0.35);
    const sh = 0.72 + 0.28 * THREE.MathUtils.clamp(v.y + 0.5, 0, 1);
    col.push(sh, sh, sh * 0.98);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
  tint: number;
  rx?: number;
}

const CHUNKS = 8;
const CHUNK_SIZE = WORLD_SIZE / CHUNKS;

export class Vegetation {
  group = new THREE.Group();
  private timeUniform = { value: 0 };
  private grass: THREE.Mesh | null = null;
  private grassUniforms: { uCam: { value: THREE.Vector3 }; uTime: { value: number } } | null = null;
  treeCount = 0;
  private chunks: { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; x: number; z: number }[] = [];
  private lodT = 0;
  private lodDist: number;

  constructor(
    private terrain: Terrain,
    private colliders: ColliderWorld,
    noise: Noise2D,
    tex: TextureSet,
    q: QualityPreset,
    /** returns true where nothing may grow (buildings, props) */
    private occupied: (x: number, z: number, r: number) => boolean,
  ) {
    const rng = mulberry32(9917);
    this.lodDist = q.treeLod;
    const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, map: tex.leaf, normalMap: tex.leafN });
    foliageMat.normalScale.set(0.9, 0.9);
    foliageMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = vec3(0.0);
#endif
float ph = ip.x * 0.13 + ip.z * 0.17;
float w1 = sin(uTime * 1.25 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7 + position.y * 0.8) * 0.25;
float w2 = cos(uTime * 1.05 + ph * 1.3) * 0.5 + sin(uTime * 3.4 + position.x * 1.5) * 0.2;
transformed.x += sway * w1 * 0.2;
transformed.z += sway * w2 * 0.14;`,
        );
    };
    const rockMat = new THREE.MeshStandardMaterial({
      map: tex.rock, normalMap: tex.rockN, vertexColors: true, roughness: 0.92, metalness: 0,
    });
    rockMat.normalScale.set(1.1, 1.1);

    // every plant exists twice: a detailed mesh for nearby chunks and a
    // cheap one that is swapped in at a distance (same seed, same silhouette)
    const build = (lo: boolean) => ({
      pine: [0, 1].map((i) => pineGeometry(mulberry32(310 + i), noise, lo)),
      leaf: [0, 1, 2].map((i) => broadleafGeometry(mulberry32(330 + i), noise, i !== 1, lo)),
      bush: [0, 1].map((i) => bushGeometry(mulberry32(350 + i), noise, lo)),
      rock: [1.3, 7.9, 15.1].map((sd) => rockGeometry(noise, sd, lo)),
    });
    const geos = build(false);
    const geosLo = build(true);

    type Kind = 'pine0' | 'pine1' | 'leaf0' | 'leaf1' | 'leaf2' | 'bush0' | 'bush1' | 'rock0' | 'rock1' | 'rock2';
    const buckets = new Map<string, Inst[]>();
    const add = (kind: Kind, inst: Inst) => {
      const ci = Math.min(CHUNKS - 1, Math.max(0, Math.floor((inst.x + WORLD_HALF) / CHUNK_SIZE)));
      const cj = Math.min(CHUNKS - 1, Math.max(0, Math.floor((inst.z + WORLD_HALF) / CHUNK_SIZE)));
      const key = `${kind}|${ci}|${cj}`;
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(inst);
    };

    // --- trees: jittered grid modulated by a forest density field -------
    const step = 7;
    for (let gz = -ISLAND_RADIUS; gz < ISLAND_RADIUS; gz += step) {
      for (let gx = -ISLAND_RADIUS; gx < ISLAND_RADIUS; gx += step) {
        const x = gx + rng() * step;
        const z = gz + rng() * step;
        const h = terrain.heightAt(x, z);
        if (h < 2.4) continue;
        const flat = terrain.flatness(x, z);
        if (flat < 0.8) continue;
        const forest = noise.fbm(x * 0.0045 + 50, z * 0.0045 - 20, 3) * 0.5 + 0.5;
        const dens = THREE.MathUtils.smoothstep(forest, 0.4, 0.66) * 0.82 + 0.035;
        if (rng() > dens) continue;
        if (terrain.splatAt(x, z, 0) > 0.08) continue;
        if (terrain.splatAt(x, z, 1) > 0.5 && rng() > 0.12) continue;
        if (this.occupied(x, z, 2.2)) continue;
        const alt = THREE.MathUtils.smoothstep(h, 18, 46);
        const pineChance = 0.25 + alt * 0.65 + (noise.noise(x * 0.01, z * 0.01) > 0.2 ? 0.25 : 0);
        const s = rrange(rng, 0.8, 1.35);
        const inst: Inst = { x, y: h - 0.15, z, ry: rng() * 6.28, sx: s, sy: s * rrange(rng, 0.92, 1.15), sz: s, tint: rrange(rng, 0.8, 1.1) };
        if (rng() < pineChance) {
          add(rng() < 0.5 ? 'pine0' : 'pine1', inst);
          colliders.addCyl(x, z, 0.26 * s, h - 1, h + 9 * s, SURF_WOOD);
        } else {
          const v = Math.floor(rng() * 3);
          add(`leaf${v}` as Kind, inst);
          colliders.addCyl(x, z, (v === 1 ? 0.24 : 0.36) * s, h - 1, h + 4.2 * s, SURF_WOOD);
        }
        this.treeCount++;
      }
    }
    // --- bushes -----------------------------------------------------------
    for (let i = 0; i < 2600; i++) {
      const a = rng() * 6.28;
      const r = Math.sqrt(rng()) * ISLAND_RADIUS;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = terrain.heightAt(x, z);
      if (h < 2.2 || terrain.flatness(x, z) < 0.82) continue;
      if (terrain.splatAt(x, z, 0) > 0.05 || terrain.splatAt(x, z, 1) > 0.4) continue;
      if (this.occupied(x, z, 1.5)) continue;
      const s = rrange(rng, 0.7, 1.5);
      add(rng() < 0.5 ? 'bush0' : 'bush1', { x, y: h - 0.1, z, ry: rng() * 6.28, sx: s, sy: s * rrange(rng, 0.8, 1.1), sz: s, tint: rrange(rng, 0.8, 1.15) });
    }
    // --- rocks ------------------------------------------------------------
    for (let i = 0; i < 1500; i++) {
      const a = rng() * 6.28;
      const r = Math.sqrt(rng()) * (ISLAND_RADIUS + 10);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = terrain.heightAt(x, z);
      if (h < -0.8) continue;
      const flat = terrain.flatness(x, z);
      const rocky = noise.fbm(x * 0.008 - 7, z * 0.008 + 91, 3) * 0.5 + 0.5;
      if (flat > 0.93 && rocky < 0.55 && rng() > 0.25) continue;
      if (terrain.splatAt(x, z, 0) > 0.05 || terrain.splatAt(x, z, 1) > 0.3) continue;
      if (this.occupied(x, z, 3)) continue;
      const big = rng() < 0.22;
      const s = big ? rrange(rng, 1.6, 3.4) : rrange(rng, 0.45, 1.3);
      const sy = s * rrange(rng, 0.6, 1.0);
      const sx = s * rrange(rng, 0.85, 1.3);
      const sz = s * rrange(rng, 0.85, 1.3);
      const tint = rrange(rng, 0.75, 1.05);
      add(`rock${Math.floor(rng() * 3)}` as Kind, { x, y: h + sy * 0.12, z, ry: rng() * 6.28, sx, sy, sz, tint, rx: rrange(rng, -0.15, 0.15) });
      if (s > 0.8) colliders.addCyl(x, z, Math.min(sx, sz) * 0.82, h - 1, h + sy * 0.86, SURF_ROCK);
    }

    const geoFor = (kind: string, lo: boolean): THREE.BufferGeometry => {
      const base = kind.slice(0, 4) as 'pine' | 'leaf' | 'bush' | 'rock';
      return (lo ? geosLo : geos)[base][Number(kind.slice(4))];
    };
    for (const [key, list] of buckets) {
      const kind = key.split('|')[0];
      const isRock = kind.startsWith('rock');
      let cx = 0;
      let cz = 0;
      const pair: THREE.InstancedMesh[] = [];
      for (const lo of [false, true]) {
        const mesh = new THREE.InstancedMesh(geoFor(kind, lo), isRock ? rockMat : foliageMat, list.length);
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          _e.set(it.rx ?? 0, it.ry, 0, 'YXZ');
          _q.setFromEuler(_e);
          _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sz));
          mesh.setMatrixAt(i, _m);
          if (isRock) _c.setRGB(it.tint, it.tint, it.tint * 0.98);
          else _c.setRGB(it.tint * 1.02, it.tint, it.tint * 0.92);
          mesh.setColorAt(i, _c);
          if (!lo) {
            cx += it.x / list.length;
            cz += it.z / list.length;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();
        mesh.castShadow = q.treeShadows && !kind.startsWith('bush');
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = lo;
        this.group.add(mesh);
        pair.push(mesh);
      }
      this.chunks.push({ hi: pair[0], lo: pair[1], x: cx, z: cz });
    }

    if (q.grass > 0) this.buildGrass(q, tex);
  }

  private buildGrass(q: QualityPreset, tex: TextureSet): void {
    const range = q.grassRange;
    const count = q.grass;
    // one clump = 4 curved blades, each a 3-segment strip
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const rng = mulberry32(4242);
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI + rng() * 0.8;
      const ox = (rng() - 0.5) * 0.5;
      const oz = (rng() - 0.5) * 0.5;
      const w = 0.017 + rng() * 0.013;
      const hgt = 0.22 + rng() * 0.3;
      const lean = (rng() - 0.5) * 0.36;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const base = pos.length / 3;
      const segs = 2;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const ww = w * (1 - t * 0.9);
        const bend = t * t * lean;
        const px = ox - cz * bend;
        const pz = oz + cx * bend;
        pos.push(px - cx * ww, t * hgt, pz - cz * ww, px + cx * ww, t * hgt, pz + cz * ww);
        uv.push(0, t, 1, t);
      }
      for (let s = 0; s < segs; s++) {
        const k = base + s * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const off = new Float32Array(count * 4);
    const side = Math.ceil(Math.sqrt(count));
    const size = range * 2;
    for (let i = 0; i < count; i++) {
      const gx = i % side;
      const gz = Math.floor(i / side);
      off[i * 4] = ((gx + rng()) / side) * size;
      off[i * 4 + 1] = ((gz + rng()) / side) * size;
      off[i * 4 + 2] = rng();
      off[i * 4 + 3] = rng();
    }
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const uniforms = {
      uCam: { value: new THREE.Vector3() },
      uTime: this.timeUniform,
      tHeight: { value: this.terrain.heightTex },
      tSplat: { value: this.terrain.splatTex },
      tNoise: { value: tex.noise },
    };
    this.grassUniforms = uniforms;
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aOffset;
uniform vec3 uCam; uniform float uTime;
uniform sampler2D tHeight; uniform sampler2D tSplat; uniform sampler2D tNoise;
varying vec3 vGrassCol;`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          `float SIZE = ${size.toFixed(1)};
vec2 wp = mod(aOffset.xy - uCam.xz, SIZE) - SIZE * 0.5 + uCam.xz;
vec2 huv = wp / ${WORLD_SIZE.toFixed(1)} + 0.5;
vec4 hd = texture2D(tHeight, huv);
vec4 sp = texture2D(tSplat, huv);
vec3 nz = texture2D(tNoise, wp * 0.0031).rgb;
vec3 nz2 = texture2D(tNoise, wp * 0.021).rgb;
float dist = length(wp - uCam.xz);
float fade = 1.0 - smoothstep(SIZE * 0.36, SIZE * 0.49, dist);
float slope = 1.0 - hd.g;
float ok = (1.0 - smoothstep(0.12, 0.22, slope)) * smoothstep(2.6, 3.6, hd.r) * (1.0 - smoothstep(48.0, 60.0, hd.r));
ok *= 1.0 - smoothstep(0.1, 0.35, sp.r);
ok *= 1.0 - smoothstep(0.25, 0.6, sp.g + (nz2.r - 0.5) * 0.6);
ok *= 1.0 - smoothstep(0.6, 0.74, nz2.g) * 0.9;
float hs = (0.6 + aOffset.z * 0.9) * (0.55 + nz.g * 0.9);
float sc = fade * ok * hs;
float ang = aOffset.w * 6.2831;
float ca = cos(ang); float sa = sin(ang);
vec3 lp = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca);
float tip = uv.y * uv.y;
float wind = sin(uTime * 1.7 + wp.x * 0.35 + wp.y * 0.27) * 0.5 + sin(uTime * 3.1 + wp.x * 1.3 - wp.y * 0.9) * 0.25;
vec3 transformed = vec3(wp.x, hd.r, wp.y) + lp * vec3(1.0, sc, 1.0) * step(0.02, sc);
transformed.x += tip * (wind * 0.14 + 0.05) * sc;
transformed.z += tip * (wind * 0.08) * sc;
vec3 base = mix(vec3(0.028, 0.055, 0.01), vec3(0.1, 0.16, 0.035), uv.y);
base *= mix(vec3(0.82, 0.92, 0.7), vec3(1.12, 1.05, 0.86), nz.r);
base = mix(base, vec3(0.33, 0.31, 0.12), smoothstep(0.55, 0.9, nz2.b) * 0.5 * uv.y);
vGrassCol = base * (0.8 + aOffset.z * 0.4);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vGrassCol;')
        .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    this.grass = mesh;
    this.group.add(mesh);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.timeUniform.value += dt;
    this.lodT -= dt;
    if (this.lodT <= 0) {
      this.lodT = 0.3;
      // height counts too so the whole island drops to the cheap meshes from the air
      const far = this.lodDist;
      for (const c of this.chunks) {
        const d = Math.hypot(c.x - camPos.x, c.z - camPos.z) + Math.max(0, camPos.y - 60) * 1.5;
        const near = d < far;
        c.hi.visible = near;
        c.lo.visible = !near;
      }
    }
    if (this.grassUniforms) this.grassUniforms.uCam.value.copy(camPos);
    // nothing to see from the aircraft or under a parachute
    if (this.grass) this.grass.visible = camPos.y - this.terrain.heightAt(camPos.x, camPos.z) < 45;
  }
}
