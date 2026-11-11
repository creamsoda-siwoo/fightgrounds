import * as THREE from 'three';
import { ZONE_PHASES } from '../config';
import { lerp, type Rng } from '../core/math';
import type { World } from './World';

/**
 * The shrinking play area: a storm wall closes in on a sequence of ever
 * smaller circles. Anyone caught outside takes damage over time.
 */
export class Zone {
  cx = 0;
  cz = 0;
  r = 900;
  /** where the current circle started shrinking from */
  private sx = 0;
  private sz = 0;
  private sr = 900;
  /** target circle */
  nx = 0;
  nz = 0;
  nr = 900;
  phase = 0;
  state: 'idle' | 'waiting' | 'shrinking' | 'final' = 'idle';
  timer = 0;
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uRadius: { value: 900 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uRadius; uniform vec3 uCam;
        varying vec3 vW; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main(){
          float arc = vUv.x * uRadius * 6.2831;
          float h = vW.y;
          float n = noise(vec2(arc * 0.05, h * 0.04 - uTime * 0.35)) * 0.6 + noise(vec2(arc * 0.21 + uTime * 0.4, h * 0.16 - uTime * 0.9)) * 0.4;
          float bolt = smoothstep(0.78, 0.82, noise(vec2(arc * 0.6, h * 0.02 + floor(uTime * 9.0)))) * step(0.86, noise(vec2(floor(uTime * 9.0), arc * 0.01)));
          float grid = smoothstep(0.92, 1.0, abs(sin(arc * 0.5))) * 0.25 + smoothstep(0.95, 1.0, abs(sin(h * 0.35 - uTime * 0.8))) * 0.2;
          float d = distance(uCam, vW);
          float near = 1.0 - smoothstep(30.0, 420.0, d);
          float fadeTop = 1.0 - smoothstep(60.0, 260.0, h);
          bolt *= near * fadeTop;
          float a = (0.2 + n * 0.42 + grid) * fadeTop * (0.42 + near * 0.58) + bolt * 0.6;
          vec3 col = mix(vec3(0.38, 0.12, 0.95), vec3(0.95, 0.35, 1.0), n) + vec3(1.2, 0.9, 1.4) * bolt;
          gl_FragColor = vec4(col * (1.1 + near * 0.6), clamp(a, 0.0, 0.92));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  start(world: World, rng: Rng): void {
    this.phase = 0;
    this.cx = this.sx = 0;
    this.cz = this.sz = 0;
    this.r = this.sr = 880;
    this.pickNext(world, rng);
    this.state = 'waiting';
    this.timer = ZONE_PHASES[0].wait;
    this.mesh.visible = true;
  }

  private pickNext(world: World, rng: Rng): void {
    const target = ZONE_PHASES[this.phase].radius;
    const slack = Math.max(0, this.r - target);
    let bx = this.cx;
    let bz = this.cz;
    let best = -Infinity;
    for (let k = 0; k < 14; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * slack * (this.phase === 0 ? 0.32 : 0.9);
      const x = this.cx + Math.cos(a) * d;
      const z = this.cz + Math.sin(a) * d;
      // prefer dry land with some elevation variety around it
      let score = Math.min(world.heightAt(x, z), 20);
      for (let s = 0; s < 6; s++) {
        const h = world.heightAt(x + Math.cos(s) * target * 0.6, z + Math.sin(s) * target * 0.6);
        score += h > 1 ? 4 : -6;
      }
      if (score > best) {
        best = score;
        bx = x;
        bz = z;
      }
    }
    this.nx = bx;
    this.nz = bz;
    this.nr = target;
  }

  update(dt: number, world: World, rng: Rng, cam: THREE.Vector3): 'none' | 'shrink' | 'next' {
    let ev: 'none' | 'shrink' | 'next' = 'none';
    if (this.state === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'shrinking';
        this.timer = ZONE_PHASES[this.phase].shrink;
        this.sx = this.cx;
        this.sz = this.cz;
        this.sr = this.r;
        ev = 'shrink';
      }
    } else if (this.state === 'shrinking') {
      this.timer -= dt;
      const total = ZONE_PHASES[this.phase].shrink;
      const t = Math.min(1, 1 - this.timer / total);
      this.cx = lerp(this.sx, this.nx, t);
      this.cz = lerp(this.sz, this.nz, t);
      this.r = lerp(this.sr, this.nr, t);
      if (this.timer <= 0) {
        this.cx = this.nx;
        this.cz = this.nz;
        this.r = this.nr;
        if (this.phase < ZONE_PHASES.length - 1) {
          this.phase++;
          this.pickNext(world, rng);
          this.state = 'waiting';
          this.timer = ZONE_PHASES[this.phase].wait;
          ev = 'next';
        } else {
          this.state = 'final';
          this.timer = 0;
        }
      }
    }
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uRadius.value = this.r;
    this.mat.uniforms.uCam.value.copy(cam);
    this.mesh.position.set(this.cx, -20, this.cz);
    this.mesh.scale.set(this.r, 420, this.r);
    return ev;
  }

  dps(): number {
    // the storm hurts as much as the phase that is currently closing
    const p = this.state === 'waiting' ? Math.max(0, this.phase - 1) : this.phase;
    return this.state === 'idle' ? 0 : ZONE_PHASES[p].dps;
  }
  inside(x: number, z: number, margin = 0): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const r = this.r - margin;
    return r > 0 && dx * dx + dz * dz <= r * r;
  }
  insideNext(x: number, z: number, margin = 0): boolean {
    const dx = x - this.nx;
    const dz = z - this.nz;
    const r = this.nr - margin;
    return r > 0 && dx * dx + dz * dz <= r * r;
  }
  stop(): void {
    this.state = 'idle';
    this.mesh.visible = false;
  }
}
