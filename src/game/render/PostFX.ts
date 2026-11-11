import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { QualityPreset } from '../config';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.9 },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uScope: { value: 0 },
    uOutside: { value: 0 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette; uniform float uDamage; uniform float uLowHp; uniform float uScope;
    uniform float uOutside; uniform float uAspect; uniform float uTime; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * r2 * 0.01).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * r2 * 0.01).b;
      // filmic grade: gentle S-curve, warm highlights, cool shadows
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.1 - uLowHp * 0.65);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += (vec3(0.012, 0.004, -0.012)) * smoothstep(0.35, 1.0, l) + vec3(-0.008, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.4, l));
      col *= 1.0 - r2 * uVignette;
      col = mix(col, col * vec3(0.72, 0.6, 1.12) + vec3(0.03, 0.0, 0.07), uOutside * 0.55);
      float edge = smoothstep(0.08, 0.5, r2 * 1.7);
      col = mix(col, vec3(0.55, 0.02, 0.01), clamp(uDamage * edge + uLowHp * edge * (0.35 + 0.15 * sin(uTime * 5.0)), 0.0, 0.85));
      if (uScope > 0.001) {
        vec2 sc = vec2(c.x * uAspect, c.y);
        float d = length(sc);
        float m = 1.0 - smoothstep(0.418, 0.43, d);
        float rim = smoothstep(0.3, 0.43, d) * 0.5;
        col = mix(col, col * m * (1.0 - rim), uScope);
      }
      col += (hash(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * 0.018;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass;
  uniforms: typeof GradeShader.uniforms;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityPreset) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.55, 2.4);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.uniforms = this.grade.uniforms as typeof GradeShader.uniforms;
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.uniforms.uAspect.value = w / h;
  }

  render(dt: number): void {
    this.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
