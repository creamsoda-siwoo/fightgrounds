import * as THREE from 'three';
import { radialTexture } from '../core/textures';
import { SURF_CONCRETE, SURF_DIRT, SURF_FLESH, SURF_METAL, SURF_ROCK, SURF_WATER, SURF_WOOD } from '../world/Colliders';

/** CPU particle pool rendered as soft point sprites. */
class ParticlePool {
  points: THREE.Points;
  private n = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private geo: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;

  constructor(private cap: number, additive: boolean, tex: THREE.Texture) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, tMap: { value: tex }, uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.0006 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize;
        uniform float uScale; uniform float uFogDensity;
        varying vec4 vColor; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(512.0, aSize * uScale / max(0.1, -mv.z));
          vColor = aColor;
          float d = length(mv.xyz) * uFogDensity;
          vFog = 1.0 - exp(-d * d);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; uniform vec3 uFogColor;
        varying vec4 vColor; varying float vFog;
        void main(){
          float a = texture2D(tMap, gl_PointCoord).a * vColor.a;
          if (a < 0.004) discard;
          vec3 c = ${additive ? 'vColor.rgb * (1.0 - vFog)' : 'mix(vColor.rgb, uFogColor, vFog)'};
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number,
    r: number, g: number, b: number, a: number, grav = 0, drag = 0,
  ): void {
    let i = this.n;
    if (i >= this.cap) i = Math.floor(Math.random() * this.cap);
    else this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.a0[i] = a;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.size[i] = s0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[l * 3 + k];
            this.vel[i * 3 + k] = this.vel[l * 3 + k];
          }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[l * 4 + k];
          this.life[i] = this.life[l];
          this.max[i] = this.max[l];
          this.s0[i] = this.s0[l];
          this.s1[i] = this.s1[l];
          this.a0[i] = this.a0[l];
          this.grav[i] = this.grav[l];
          this.drag[i] = this.drag[l];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.25);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    if (this.n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }
  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}

interface Tracer {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  len: number;
  t: number;
  speed: number;
}

const TRACERS = 96;
const DECALS = 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

export class Effects {
  group = new THREE.Group();
  private smoke: ParticlePool;
  private glow: ParticlePool;
  private tracers: Tracer[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private decalMesh: THREE.InstancedMesh;
  private decalNext = 0;
  private flash: THREE.PointLight;
  private flashT = 0;
  private boom: THREE.PointLight;
  private boomT = 0;

  constructor(fog: THREE.FogExp2) {
    const soft = radialTexture(64, 0.05);
    this.smoke = new ParticlePool(2200, false, soft);
    this.glow = new ParticlePool(900, true, soft);
    for (const p of [this.smoke, this.glow]) {
      p.material.uniforms.uFogColor.value.copy(fog.color);
      p.material.uniforms.uFogDensity.value = fog.density;
      this.group.add(p.points);
    }
    const tg = new THREE.BoxGeometry(1, 1, 1);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 0.9), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracerMesh = new THREE.InstancedMesh(tg, tm, TRACERS);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    this.tracerMesh.renderOrder = 7;
    this.group.add(this.tracerMesh);

    const dm = new THREE.MeshBasicMaterial({
      map: radialTexture(32, 0.25, false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexColors: false,
    });
    this.decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dm, DECALS);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.count = DECALS;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < DECALS; i++) {
      this.decalMesh.setMatrixAt(i, _m);
      this.decalMesh.setColorAt(i, _c.setRGB(0.03, 0.03, 0.03));
    }
    this.decalMesh.renderOrder = 4;
    this.group.add(this.decalMesh);

    this.flash = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.36), 0, 16, 2);
    this.boom = new THREE.PointLight(new THREE.Color(1.0, 0.6, 0.25), 0, 60, 2);
    this.group.add(this.flash, this.boom);
  }

  setViewport(height: number, fovDeg: number): void {
    const scale = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.smoke.material.uniforms.uScale.value = scale;
    this.glow.material.uniforms.uScale.value = scale;
  }

  tracer(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number): void {
    const dx = ex - ox;
    const dy = ey - oy;
    const dz = ez - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 3) return;
    if (this.tracers.length >= TRACERS) this.tracers.shift();
    this.tracers.push({ ox, oy, oz, dx: dx / len, dy: dy / len, dz: dz / len, len, t: 1.2, speed: 380 });
  }

  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, big: boolean, lit: boolean): void {
    const n = big ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const k = 0.08 + i * 0.11;
      this.glow.emit(x + dx * k, y + dy * k, z + dz * k, dx * 3, dy * 3, dz * 3, 0.05, (big ? 0.5 : 0.34) * (1 - i * 0.14), 0.1, 2.6, 1.7, 0.6, 0.9);
    }
    this.smoke.emit(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, dx * 1.5 + (Math.random() - 0.5), dy * 1.5 + 0.5, dz * 1.5 + (Math.random() - 0.5), 0.6, 0.15, 0.9, 0.75, 0.75, 0.75, 0.22, -0.4, 2.5);
    if (lit) {
      this.flash.position.set(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3);
      this.flashT = 0.06;
    }
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surf: number): void {
    const R = Math.random;
    if (surf === SURF_WATER) {
      for (let i = 0; i < 7; i++) this.smoke.emit(x, 0.05, z, (R() - 0.5) * 1.6, 2.2 + R() * 2.4, (R() - 0.5) * 1.6, 0.55, 0.12, 0.3, 0.86, 0.93, 0.97, 0.75, 9, 0.5);
      this.smoke.emit(x, 0.08, z, 0, 0.2, 0, 0.7, 0.3, 1.3, 0.9, 0.95, 1, 0.35);
      return;
    }
    if (surf === SURF_FLESH) {
      for (let i = 0; i < 6; i++) this.smoke.emit(x, y, z, nx * 1.5 + (R() - 0.5) * 2, ny * 1.5 + R() * 1.2, nz * 1.5 + (R() - 0.5) * 2, 0.32, 0.07, 0.2, 0.42, 0.02, 0.02, 0.85, 7, 2);
      this.smoke.emit(x, y, z, nx, ny + 0.3, nz, 0.3, 0.14, 0.5, 0.45, 0.03, 0.03, 0.4, 0, 3);
      return;
    }
    let r = 0.42;
    let g = 0.36;
    let b = 0.28;
    let sparks = 0;
    if (surf === SURF_CONCRETE || surf === SURF_ROCK) {
      r = 0.62;
      g = 0.6;
      b = 0.57;
      sparks = 1;
    } else if (surf === SURF_METAL) {
      r = 0.4;
      g = 0.4;
      b = 0.42;
      sparks = 6;
    } else if (surf === SURF_WOOD) {
      r = 0.5;
      g = 0.38;
      b = 0.24;
    } else if (surf === SURF_DIRT) {
      r = 0.34;
      g = 0.28;
      b = 0.19;
    }
    for (let i = 0; i < 5; i++) {
      this.smoke.emit(x, y, z, nx * (1 + R() * 2.5) + (R() - 0.5) * 2, ny * (1 + R() * 2.5) + R() * 1.5, nz * (1 + R() * 2.5) + (R() - 0.5) * 2, 0.4 + R() * 0.3, 0.05, 0.14, r, g, b, 0.9, 9, 1.5);
    }
    this.smoke.emit(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 1.2, ny * 1.2 + 0.4, nz * 1.2, 0.75, 0.16, 0.95, r * 1.15, g * 1.15, b * 1.15, 0.42, -0.3, 2.2);
    for (let i = 0; i < sparks; i++) {
      this.glow.emit(x, y, z, nx * 4 + (R() - 0.5) * 7, ny * 4 + R() * 4, nz * 4 + (R() - 0.5) * 7, 0.16 + R() * 0.2, 0.05, 0.02, 3, 2, 0.7, 1, 12, 1);
    }
    // bullet hole
    _n.set(nx, ny, nz);
    _q.setFromUnitVectors(Z, _n);
    const sz = surf === SURF_DIRT ? 0.16 : 0.1;
    _m.compose(_p.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012), _q, _s.set(sz, sz, sz));
    this.decalMesh.setMatrixAt(this.decalNext, _m);
    this.decalMesh.setColorAt(this.decalNext, _c.setRGB(0.025, 0.022, 0.02));
    this.decalNext = (this.decalNext + 1) % DECALS;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    if (this.decalMesh.instanceColor) this.decalMesh.instanceColor.needsUpdate = true;
  }

  explosion(x: number, y: number, z: number): void {
    const R = Math.random;
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.28;
      const e = R() * 1.4;
      const sp = 3 + R() * 9;
      this.glow.emit(x, y + 0.3, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp, 0.25 + R() * 0.3, 1.2, 3.2, 3.2, 1.6 + R(), 0.35, 0.95, 0, 3);
    }
    for (let i = 0; i < 34; i++) {
      const a = R() * 6.28;
      const sp = 1 + R() * 6;
      const sh = 0.16 + R() * 0.2;
      this.smoke.emit(x + Math.cos(a) * 0.5, y + 0.4 + R(), z + Math.sin(a) * 0.5, Math.cos(a) * sp, 1.5 + R() * 5, Math.sin(a) * sp, 1.6 + R() * 1.8, 1.0, 5.5, sh, sh, sh, 0.75, -0.6, 1.6);
    }
    for (let i = 0; i < 30; i++) {
      const a = R() * 6.28;
      const sp = 5 + R() * 13;
      this.smoke.emit(x, y + 0.2, z, Math.cos(a) * sp, 4 + R() * 10, Math.sin(a) * sp, 0.9 + R() * 0.7, 0.1, 0.16, 0.3, 0.25, 0.18, 1, 16, 0.4);
      if (i % 2 === 0) this.glow.emit(x, y + 0.2, z, Math.cos(a) * sp * 1.3, 3 + R() * 9, Math.sin(a) * sp * 1.3, 0.4 + R() * 0.5, 0.09, 0.02, 3, 1.8, 0.5, 1, 14, 0.6);
    }
    this.boom.position.set(x, y + 1.2, z);
    this.boomT = 0.35;
    // scorch mark
    _q.setFromUnitVectors(Z, _n.set(0, 1, 0));
    _m.compose(_p.set(x, y + 0.03, z), _q, _s.set(5.2, 5.2, 5.2));
    this.decalMesh.setMatrixAt(this.decalNext, _m);
    this.decalMesh.setColorAt(this.decalNext, _c.setRGB(0.01, 0.01, 0.01));
    this.decalNext = (this.decalNext + 1) % DECALS;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    if (this.decalMesh.instanceColor) this.decalMesh.instanceColor.needsUpdate = true;
  }

  dust(x: number, y: number, z: number, amount = 3): void {
    for (let i = 0; i < amount; i++) {
      this.smoke.emit(x + (Math.random() - 0.5) * 0.3, y + 0.05, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8, 0.7, 0.2, 0.8, 0.5, 0.44, 0.34, 0.22, -0.1, 1.5);
    }
  }

  /** drifting marker smoke (death crates, landing puffs) */
  puff(x: number, y: number, z: number, r: number, g: number, b: number): void {
    this.smoke.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4, 2.6, 0.4, 2.2, r, g, b, 0.32, -0.1, 0.5);
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.glow.update(dt);
    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += t.speed * dt;
      if (t.t > t.len) {
        this.tracers.splice(i, 1);
        continue;
      }
      const tail = Math.max(0, t.t - Math.min(11, t.len * 0.5));
      const seg = t.t - tail;
      const mid = (t.t + tail) / 2;
      _d.set(t.dx, t.dy, t.dz);
      _q.setFromUnitVectors(Z, _d);
      _m.compose(_p.set(t.ox + t.dx * mid, t.oy + t.dy * mid, t.oz + t.dz * mid), _q, _s.set(0.028, 0.028, seg));
      this.tracerMesh.setMatrixAt(n++, _m);
    }
    this.tracerMesh.count = n;
    if (n > 0) this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.flashT -= dt;
    this.flash.intensity = this.flashT > 0 ? 55 * (this.flashT / 0.06) : 0;
    this.boomT -= dt;
    this.boom.intensity = this.boomT > 0 ? 900 * Math.pow(this.boomT / 0.35, 2) : 0;
  }

  clear(): void {
    this.smoke.clear();
    this.glow.clear();
    this.tracers.length = 0;
    this.tracerMesh.count = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < DECALS; i++) this.decalMesh.setMatrixAt(i, _m);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }
}
