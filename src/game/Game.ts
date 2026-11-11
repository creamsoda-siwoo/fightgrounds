import * as THREE from 'three';
import { QUALITY, type Quality } from './config';
import { PostFX } from './render/PostFX';
import { World } from './world/World';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.12, 4000);
  world = new World();
  post!: PostFX;
  private raf = 0;
  private last = 0;
  private t = 0;
  quality: Quality;
  manual = false;
  onProgress: (p: number, label: string) => void = () => {};
  debugCam: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  async init(): Promise<void> {
    const q = QUALITY[this.quality];
    await this.world.generate(this.scene, this.renderer, q, async (p, label) => {
      this.onProgress(p, label);
      await new Promise((r) => setTimeout(r, 16));
    });
    this.post = new PostFX(this.renderer, this.scene, this.camera, q);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.onProgress(1, '완료');
    this.last = performance.now();
    if (!this.manual) this.raf = requestAnimationFrame(this.frame);
  }

  /** test hook: advance and draw exactly one frame */
  step(dt: number): void {
    this.last = performance.now() - dt * 1000;
    this.frame(performance.now());
    cancelAnimationFrame(this.raf);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = QUALITY[this.quality];
    const pr = Math.min(window.devicePixelRatio, 2) * q.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, pr);
  };

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (this.debugCam) {
      const d = this.debugCam;
      this.camera.position.set(d.x, d.y, d.z);
      this.camera.lookAt(d.tx, d.ty, d.tz);
    } else {
      const a = this.t * 0.03;
      this.camera.position.set(Math.cos(a) * 520, 190, Math.sin(a) * 520);
      this.camera.lookAt(0, 20, 0);
    }
    this.world.update(dt, this.camera);
    this.post.render(dt);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
