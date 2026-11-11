import * as THREE from 'three';

/**
 * Procedural modelling helper. Everything in the world that is not terrain or
 * foliage is assembled from primitives pushed into per-material buckets and
 * merged into a handful of draw calls.
 */
interface Bucket {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  idx: number[];
  skin?: number[];
}

export interface BoxOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  /** texture repeats per metre (default 1) */
  uv?: number;
  /** skip faces: 'b' bottom, 't' top */
  skip?: string;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

// face table: normal axis, u axis, v axis
const FACES: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number]; id: string }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], id: 'e' },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], id: 'w' },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], id: 't' },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], id: 'b' },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], id: 's' },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], id: 'n' },
];

export class GeoBuilder {
  private buckets = new Map<string, Bucket>();
  private stack: THREE.Matrix4[] = [];
  private cur = new THREE.Matrix4();
  /** when set, every vertex is rigidly bound to this bone index */
  bone = -1;

  private bucket(mat: string): Bucket {
    let b = this.buckets.get(mat);
    if (!b) {
      b = { pos: [], nor: [], uv: [], col: [], idx: [] };
      if (this.bone >= 0) b.skin = [];
      this.buckets.set(mat, b);
    }
    if (this.bone >= 0 && !b.skin) b.skin = [];
    return b;
  }

  push(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): this {
    this.stack.push(this.cur.clone());
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s);
    this.cur.multiply(_m);
    return this;
  }
  pushMatrix(m: THREE.Matrix4): this {
    this.stack.push(this.cur.clone());
    this.cur.multiply(m);
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.cur.copy(m);
    return this;
  }
  /** current transform (copy) */
  matrix(): THREE.Matrix4 {
    return this.cur.clone();
  }

  /** Axis aligned (in local space) box centred at x,y,z. UVs are in metres. */
  box(mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color = 0xffffff, o?: BoxOpts): this {
    const b = this.bucket(mat);
    const uvs = o?.uv ?? 1;
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    const local = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
    local.premultiply(this.cur);
    _c.set(color);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const half = [hx, hy, hz];
    for (const f of FACES) {
      if (o?.skip && o.skip.includes(f.id)) continue;
      const base = b.pos.length / 3;
      const nd = Math.abs(f.n[0]) * hx + Math.abs(f.n[1]) * hy + Math.abs(f.n[2]) * hz;
      const ud = Math.abs(f.u[0]) * half[0] + Math.abs(f.u[1]) * half[1] + Math.abs(f.u[2]) * half[2];
      const vd = Math.abs(f.v[0]) * half[0] + Math.abs(f.v[1]) * half[1] + Math.abs(f.v[2]) * half[2];
      for (let k = 0; k < 4; k++) {
        const su = k === 0 || k === 3 ? -1 : 1;
        const sv = k < 2 ? -1 : 1;
        _v.set(
          f.n[0] * nd + f.u[0] * ud * su + f.v[0] * vd * sv,
          f.n[1] * nd + f.u[1] * ud * su + f.v[1] * vd * sv,
          f.n[2] * nd + f.u[2] * ud * su + f.v[2] * vd * sv,
        ).applyMatrix4(local);
        _n.set(f.n[0], f.n[1], f.n[2]).transformDirection(local);
        b.pos.push(_v.x, _v.y, _v.z);
        b.nor.push(_n.x, _n.y, _n.z);
        b.uv.push((su * ud + ud) * uvs, (sv * vd + vd) * uvs);
        b.col.push(_c.r, _c.g, _c.b);
        if (b.skin) b.skin.push(this.bone);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /**
   * Append an arbitrary geometry. `color` multiplies an existing colour
   * attribute or fills one in.
   */
  geo(mat: string, g: THREE.BufferGeometry, color = 0xffffff, local?: THREE.Matrix4, uvScale = 1): this {
    const b = this.bucket(mat);
    const m = local ? _m.copy(this.cur).multiply(local) : _m.copy(this.cur);
    const pos = g.getAttribute('position');
    let nor = g.getAttribute('normal');
    if (!nor) {
      g.computeVertexNormals();
      nor = g.getAttribute('normal');
    }
    const uv = g.getAttribute('uv');
    const col = g.getAttribute('color');
    const base = b.pos.length / 3;
    _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      _n.fromBufferAttribute(nor, i).transformDirection(m);
      b.pos.push(_v.x, _v.y, _v.z);
      b.nor.push(_n.x, _n.y, _n.z);
      if (uv) b.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale);
      else b.uv.push(0, 0);
      if (col) b.col.push(col.getX(i) * _c.r, col.getY(i) * _c.g, col.getZ(i) * _c.b);
      else b.col.push(_c.r, _c.g, _c.b);
      if (b.skin) b.skin.push(this.bone);
    }
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    }
    return this;
  }

  /** helpers for the most common round primitives (axis along local Y) */
  cyl(mat: string, x: number, y: number, z: number, rTop: number, rBot: number, h: number, color = 0xffffff, seg = 10, o?: BoxOpts): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ');
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(1, 1, 1));
    this.geo(mat, g, color, local, o?.uv ?? 1);
    g.dispose();
    return this;
  }
  sphere(mat: string, x: number, y: number, z: number, r: number, color = 0xffffff, sx = 1, sy = 1, sz = 1, seg = 10): this {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    this.geo(mat, g, color, local);
    g.dispose();
    return this;
  }
  capsule(mat: string, x: number, y: number, z: number, r: number, len: number, color = 0xffffff, o?: BoxOpts & { sx?: number; sz?: number }): this {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 4, 10);
    _e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0, 'YXZ');
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(_e),
      new THREE.Vector3(o?.sx ?? 1, 1, o?.sz ?? 1),
    );
    this.geo(mat, g, color, local);
    g.dispose();
    return this;
  }

  /** Triangular prism (gable end). Base along local X, apex up, extruded along Z. */
  gable(mat: string, x: number, y: number, z: number, width: number, height: number, depth: number, color = 0xffffff, uvs = 1): this {
    const b = this.bucket(mat);
    _c.set(color);
    const hw = width / 2;
    const hd = depth / 2;
    const pts: [number, number, number][] = [
      [-hw, 0, hd], [hw, 0, hd], [0, height, hd],
      [hw, 0, -hd], [-hw, 0, -hd], [0, height, -hd],
    ];
    const nrm: [number, number, number][] = [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, -1], [0, 0, -1], [0, 0, -1]];
    const local = new THREE.Matrix4().makeTranslation(x, y, z).premultiply(this.cur);
    const base = b.pos.length / 3;
    for (let i = 0; i < 6; i++) {
      _v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(local);
      _n.set(nrm[i][0], nrm[i][1], nrm[i][2]).transformDirection(local);
      b.pos.push(_v.x, _v.y, _v.z);
      b.nor.push(_n.x, _n.y, _n.z);
      b.uv.push((pts[i][0] + hw) * uvs, pts[i][1] * uvs);
      b.col.push(_c.r, _c.g, _c.b);
      if (b.skin) b.skin.push(this.bone);
    }
    b.idx.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
    return this;
  }

  build(): Record<string, THREE.BufferGeometry> {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const [key, b] of this.buckets) {
      if (b.pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      if (b.skin && b.skin.length === b.pos.length / 3) {
        const n = b.skin.length;
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = Math.max(0, b.skin[i]);
          sw[i * 4] = 1;
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      }
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out[key] = g;
    }
    return out;
  }

  /** Merge every bucket into one geometry (vertex colours only). */
  buildSingle(): THREE.BufferGeometry {
    const parts = this.build();
    const keys = Object.keys(parts);
    if (keys.length === 1) return parts[keys[0]];
    const merged = new GeoBuilder();
    merged.bone = -1;
    for (const k of keys) merged.geo('all', parts[k]);
    return merged.build()['all'];
  }
}
