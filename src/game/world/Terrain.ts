import * as THREE from 'three';
import { ISLAND_RADIUS, TERRAIN_SEG, WORLD_HALF, WORLD_SIZE } from '../config';
import { Noise2D, clamp, lerp, smoothstep } from '../core/math';
import type { TextureSet } from '../core/textures';

export interface SiteDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  yaw: number;
  kind: 'town' | 'village' | 'harbor' | 'farm' | 'outpost' | 'depot' | 'cabins' | 'lumber' | 'lighthouse';
  /** filled in by the terrain once the ground is levelled */
  baseY: number;
}

export interface RoadDef {
  pts: [number, number][];
  width: number;
}

const N = TERRAIN_SEG + 1;
const CELL = WORLD_SIZE / TERRAIN_SEG;
export const SPLAT_SIZE = 1024;

/** Height of the untouched island before settlements are levelled. */
export function rawTerrainHeight(n: Noise2D, x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z) / ISLAND_RADIUS;
  const coast = n.fbm(x * 0.0021 + 31.7, z * 0.0021 - 12.3, 4) * 0.34;
  const mask = smoothstep(1.02, 0.6, r + coast);
  const base = n.fbm(x * 0.0026, z * 0.0026, 5) * 0.5 + 0.5;
  const hills = Math.pow(base, 1.7) * 50;
  const mtnMask = smoothstep(0.08, 0.5, n.fbm(x * 0.0014 - 80, z * 0.0014 + 40, 3));
  const ridges = n.ridged(x * 0.0042 + 9, z * 0.0042 + 3, 4) * 62 * mtnMask;
  const detail = n.fbm(x * 0.018, z * 0.018, 3) * 1.6 + n.noise(x * 0.07, z * 0.07) * 0.25;
  const land = 2.2 + hills + ridges + detail;
  return land * mask - (1 - mask) * 16 + mask * (1 - mask) * 6;
}

export class Terrain {
  heights = new Float32Array(N * N);
  normals = new Float32Array(N * N * 3);
  /** r = road, g = settlement ground. Row 0 is z = -half. */
  splat = new Uint8ClampedArray(SPLAT_SIZE * SPLAT_SIZE * 4);
  mesh!: THREE.Mesh;
  heightTex!: THREE.DataTexture;
  splatTex!: THREE.DataTexture;
  material!: THREE.MeshStandardMaterial;

  constructor(private noise: Noise2D, private sites: SiteDef[], private roads: RoadDef[]) {
    this.generate();
    this.paintSplat();
    this.computeNormals();
  }

  private rawHeight(x: number, z: number): number {
    return rawTerrainHeight(this.noise, x, z);
  }

  private generate(): void {
    const h = this.heights;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        h[j * N + i] = this.rawHeight(-WORLD_HALF + i * CELL, -WORLD_HALF + j * CELL);
      }
    }
    // level the ground under settlements
    for (const s of this.sites) {
      let sum = 0;
      let cnt = 0;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        for (const rr of [0, 0.4, 0.8]) {
          sum += this.rawHeight(s.x + Math.cos(ang) * s.radius * rr, s.z + Math.sin(ang) * s.radius * rr);
          cnt++;
        }
      }
      s.baseY = clamp(sum / cnt, 2.6, 46);
      const R = s.radius * 1.75;
      const i0 = Math.max(0, Math.floor((s.x - R + WORLD_HALF) / CELL));
      const i1 = Math.min(N - 1, Math.ceil((s.x + R + WORLD_HALF) / CELL));
      const j0 = Math.max(0, Math.floor((s.z - R + WORLD_HALF) / CELL));
      const j1 = Math.min(N - 1, Math.ceil((s.z + R + WORLD_HALF) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -WORLD_HALF + i * CELL;
          const z = -WORLD_HALF + j * CELL;
          const d = Math.hypot(x - s.x, z - s.z);
          const w = smoothstep(R, s.radius * 1.02, d);
          if (w > 0) h[j * N + i] = lerp(h[j * N + i], s.baseY, w);
        }
      }
    }
    // soften the ground along roads so they do not climb cliffs
    for (let pass = 0; pass < 2; pass++) {
      for (const road of this.roads) {
        for (let k = 0; k < road.pts.length - 1; k++) {
          const [ax, az] = road.pts[k];
          const [bx, bz] = road.pts[k + 1];
          const len = Math.hypot(bx - ax, bz - az);
          const steps = Math.ceil(len / 2);
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = lerp(ax, bx, t);
            const z = lerp(az, bz, t);
            const ci = Math.round((x + WORLD_HALF) / CELL);
            const cj = Math.round((z + WORLD_HALF) / CELL);
            if (ci < 2 || cj < 2 || ci >= N - 2 || cj >= N - 2) continue;
            let avg = 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) avg += h[(cj + dj) * N + ci + di];
            avg /= 9;
            avg = Math.max(avg, 1.2);
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const idx = (cj + dj) * N + ci + di;
              h[idx] = lerp(h[idx], avg, di === 0 && dj === 0 ? 0.8 : 0.45);
            }
          }
        }
      }
    }
  }

  private paintSplat(): void {
    const S = SPLAT_SIZE;
    const sp = this.splat;
    const toPx = (v: number) => ((v + WORLD_HALF) / WORLD_SIZE) * S;
    const scale = S / WORLD_SIZE;
    const stamp = (cx: number, cz: number, rad: number, ch: number, strength: number) => {
      const px = toPx(cx);
      const pz = toPx(cz);
      const pr = rad * scale;
      const x0 = Math.max(0, Math.floor(px - pr - 1));
      const x1 = Math.min(S - 1, Math.ceil(px + pr + 1));
      const z0 = Math.max(0, Math.floor(pz - pr - 1));
      const z1 = Math.min(S - 1, Math.ceil(pz + pr + 1));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz) / pr;
          const v = (1 - smoothstep(0.55, 1, d)) * strength * 255;
          const i = (z * S + x) * 4 + ch;
          if (v > sp[i]) sp[i] = v;
        }
      }
    };
    for (const road of this.roads) {
      for (let k = 0; k < road.pts.length - 1; k++) {
        const [ax, az] = road.pts[k];
        const [bx, bz] = road.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.ceil(len / 0.8);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          stamp(lerp(ax, bx, t), lerp(az, bz, t), road.width * 0.75, 0, 1);
        }
      }
    }
    for (const s of this.sites) {
      // irregular worn ground inside settlements
      for (let k = 0; k < 90; k++) {
        const a = this.noise.noise(k * 3.1 + s.x, 7.7) * Math.PI * 2;
        const rr = (0.5 + 0.5 * this.noise.noise(k * 1.7, s.z * 0.1 + 3)) * s.radius * 0.95;
        stamp(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, 7 + (k % 5) * 2.5, 1, 0.55);
      }
      stamp(s.x, s.z, s.radius * 0.5, 1, 0.5);
    }
    for (let i = 3; i < sp.length; i += 4) sp[i] = 255;
  }

  /** stamp extra dirt under a building / prop cluster */
  paintGround(x: number, z: number, rad: number, strength = 0.9): void {
    const S = SPLAT_SIZE;
    const sp = this.splat;
    const scale = S / WORLD_SIZE;
    const px = ((x + WORLD_HALF) / WORLD_SIZE) * S;
    const pz = ((z + WORLD_HALF) / WORLD_SIZE) * S;
    const pr = rad * scale;
    const x0 = Math.max(0, Math.floor(px - pr - 1));
    const x1 = Math.min(S - 1, Math.ceil(px + pr + 1));
    const z0 = Math.max(0, Math.floor(pz - pr - 1));
    const z1 = Math.min(S - 1, Math.ceil(pz + pr + 1));
    for (let zz = z0; zz <= z1; zz++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - px, zz + 0.5 - pz) / pr;
        const v = (1 - smoothstep(0.6, 1, d)) * strength * 255;
        const i = (zz * S + xx) * 4 + 1;
        if (v > sp[i]) sp[i] = v;
      }
    }
  }

  private computeNormals(): void {
    const h = this.heights;
    const nr = this.normals;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const l = h[j * N + Math.max(0, i - 1)];
        const r = h[j * N + Math.min(N - 1, i + 1)];
        const u = h[Math.max(0, j - 1) * N + i];
        const d = h[Math.min(N - 1, j + 1) * N + i];
        let nx = l - r;
        let nz = u - d;
        let ny = 2 * CELL;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const k = (j * N + i) * 3;
        nr[k] = nx;
        nr[k + 1] = ny;
        nr[k + 2] = nz;
      }
    }
  }

  heightAt(x: number, z: number): number {
    const fx = (x + WORLD_HALF) / CELL;
    const fz = (z + WORLD_HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return -16;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const h00 = h[j * N + i];
    const h10 = h[j * N + i + 1];
    const h01 = h[(j + 1) * N + i];
    const h11 = h[(j + 1) * N + i + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** y component of the surface normal (1 = flat). */
  flatness(x: number, z: number): number {
    const fx = clamp(Math.round((x + WORLD_HALF) / CELL), 0, N - 1);
    const fz = clamp(Math.round((z + WORLD_HALF) / CELL), 0, N - 1);
    return this.normals[(fz * N + fx) * 3 + 1];
  }
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const fx = clamp(Math.round((x + WORLD_HALF) / CELL), 0, N - 1);
    const fz = clamp(Math.round((z + WORLD_HALF) / CELL), 0, N - 1);
    const k = (fz * N + fx) * 3;
    return out.set(this.normals[k], this.normals[k + 1], this.normals[k + 2]);
  }

  splatAt(x: number, z: number, channel: 0 | 1): number {
    const px = Math.floor(((x + WORLD_HALF) / WORLD_SIZE) * SPLAT_SIZE);
    const pz = Math.floor(((z + WORLD_HALF) / WORLD_SIZE) * SPLAT_SIZE);
    if (px < 0 || pz < 0 || px >= SPLAT_SIZE || pz >= SPLAT_SIZE) return 0;
    return this.splat[(pz * SPLAT_SIZE + px) * 4 + channel] / 255;
  }

  /** March a ray over the height field. Returns distance or -1. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    let t = 0;
    let prevT = 0;
    let prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) return 0;
    while (t < maxDist) {
      const step = Math.max(0.8, Math.min(6, prevAbove * 0.5));
      t = Math.min(maxDist, t + step);
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      const above = y - this.heightAt(x, z);
      if (above < 0) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 7; k++) {
          const m = (a + b) / 2;
          if (oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m) < 0) b = m;
          else a = m;
        }
        return a;
      }
      if (y > 140 && dy >= 0) return -1;
      prevAbove = above;
      prevT = t;
    }
    return -1;
  }

  build(tex: TextureSet, aniso: number, cheap = false): THREE.Mesh {
    const pos = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -WORLD_HALF + i * CELL;
        const z = -WORLD_HALF + j * CELL;
        pos[k * 3] = x;
        pos[k * 3 + 1] = this.heights[k];
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / 5;
        uv[k * 2 + 1] = z / 5;
      }
    }
    const idx = new Uint32Array(TERRAIN_SEG * TERRAIN_SEG * 6);
    let p = 0;
    for (let j = 0; j < TERRAIN_SEG; j++) {
      for (let i = 0; i < TERRAIN_SEG; i++) {
        const a = j * N + i;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    // GPU side copies for grass / water
    const hd = new Float32Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      hd[k * 4] = this.heights[k];
      hd[k * 4 + 1] = this.normals[k * 3 + 1];
      hd[k * 4 + 2] = this.normals[k * 3];
      hd[k * 4 + 3] = this.normals[k * 3 + 2];
    }
    this.heightTex = new THREE.DataTexture(hd, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    this.splatTex = new THREE.DataTexture(new Uint8Array(this.splat.buffer), SPLAT_SIZE, SPLAT_SIZE, THREE.RGBAFormat);
    this.splatTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.generateMipmaps = true;
    this.splatTex.needsUpdate = true;

    for (const t of [tex.grass, tex.dirt, tex.rock, tex.sand, tex.groundNormal]) t.anisotropy = aniso;

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, normalMap: tex.groundNormal });
    mat.normalScale.set(0.9, 0.9);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tGrass = { value: tex.grass };
      shader.uniforms.tDirt = { value: tex.dirt };
      shader.uniforms.tRock = { value: tex.rock };
      shader.uniforms.tSand = { value: tex.sand };
      shader.uniforms.tSplat = { value: this.splatTex };
      shader.uniforms.tNoise = { value: tex.noise };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vNy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvNy = normal.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; uniform sampler2D tSand;
uniform sampler2D tSplat; uniform sampler2D tNoise;
varying vec3 vWPos; varying float vNy;
${cheap ? 'vec3 layered(sampler2D t, vec2 p, float farMix){ return texture2D(t, p * mix(0.31, 0.043, farMix)).rgb; }' : `vec3 layered(sampler2D t, vec2 p, float farMix){
  vec3 a = texture2D(t, p * 0.31).rgb;
  vec3 b = texture2D(t, p * 0.043).rgb;
  return mix(a, b, farMix) * (0.55 + 0.9 * dot(texture2D(t, p * 0.011).rgb, vec3(0.333)) * 1.6);
}`}`,
        )
        .replace(
          '#include <map_fragment>',
          `{
  vec2 p = vWPos.xz;
  float dist = length(cameraPosition - vWPos);
  float farMix = smoothstep(18.0, 140.0, dist);
  vec3 nz = texture2D(tNoise, p * 0.0031).rgb;
  vec3 nz2 = texture2D(tNoise, p * 0.021).rgb;
  vec4 sp = texture2D(tSplat, p / ${WORLD_SIZE.toFixed(1)} + 0.5);
  vec3 grass = layered(tGrass, p, farMix);
  grass *= mix(vec3(0.82, 0.92, 0.7), vec3(1.12, 1.05, 0.86), nz.r);
  vec3 dirt = layered(tDirt, p, farMix);
  vec3 rock = layered(tRock, p * 0.6, farMix);
  vec3 sand = layered(tSand, p, farMix);
  float slope = 1.0 - vNy;
  float h = vWPos.y;
  float rockW = smoothstep(0.16, 0.34, slope + (nz2.g - 0.5) * 0.12);
  rockW = max(rockW, smoothstep(52.0, 72.0, h + nz.g * 14.0) * 0.8);
  float sandW = 1.0 - smoothstep(0.9, 2.9, h + (nz2.r - 0.5) * 1.6);
  float road = smoothstep(0.25, 0.75, sp.r + (nz2.b - 0.5) * 0.35);
  float worn = smoothstep(0.2, 0.8, sp.g + (nz2.r - 0.5) * 0.6);
  float patches = smoothstep(0.66, 0.8, nz2.g) * 0.55;
  vec3 c = grass;
  c = mix(c, dirt, max(patches, worn * 0.85));
  c = mix(c, rock, rockW);
  c = mix(c, sand, sandW * (1.0 - rockW * 0.6));
  c = mix(c, mix(dirt, vec3(dot(dirt, vec3(0.333))), 0.45) * vec3(1.02, 1.0, 0.96), road);
  c *= mix(0.62, 1.0, smoothstep(-0.6, 0.5, h));
  diffuseColor.rgb = c;
}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
roughnessFactor = mix(roughnessFactor, 0.55, (1.0 - smoothstep(-0.2, 0.45, vWPos.y)) * 0.8);`,
        );
    };
    this.material = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    return this.mesh;
  }

  refreshSplat(): void {
    if (this.splatTex) this.splatTex.needsUpdate = true;
  }
}
