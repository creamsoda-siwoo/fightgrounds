import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { WORLD_SIZE, type QualityPreset } from '../config';
import type { TextureSet } from '../core/textures';

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Sky dome, sun, ambient light, fog, image based lighting and the ocean. */
export class Environment {
  sunDir = new THREE.Vector3();
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  water: THREE.Mesh;
  private waterMat: THREE.ShaderMaterial;
  private sunSprite!: THREE.Sprite;
  private time = 0;
  private shadowRange: number;
  fogColor = new THREE.Color();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, q: QualityPreset, tex: TextureSet, heightTex: THREE.Texture) {
    const elevation = 33;
    const azimuth = 205;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta).normalize();

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.2;
    u.rayleigh.value = 1.25;
    u.mieCoefficient.value = 0.0045;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    u.cloudCoverage.value = 0.46;
    u.cloudDensity.value = 0.52;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00022;
    // the analytic sun disc is thousands of nits and floods the bloom pass;
    // a sprite with a controlled HDR core gives the same read without it
    u.showSunDisc.value = 0;
    // keep the forward-scattering halo from blowing out the whole frame
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      'gl_FragColor.rgb = gl_FragColor.rgb / (1.0 + max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b) * 0.42);\n#include <tonemapping_fragment>',
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    const sunTex = (() => {
      const N = 128;
      const data = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
        const core = d < 0.16 ? 1 : 0;
        const halo = Math.pow(Math.max(0, 1 - d), 3.2) * 0.42;
        const a = Math.min(1, core + halo);
        const i = (y * N + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = a * 255;
      }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    })();
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunTex, color: new THREE.Color(9, 7.6, 5.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.sunSprite.scale.setScalar(300);
    this.sunSprite.renderOrder = -9;
    scene.add(this.sunSprite);

    // image based lighting from the sky itself
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    const eu = envSky.material.uniforms;
    for (const k of Object.keys(u)) {
      const v = u[k].value;
      if (v && typeof v === 'object' && 'copy' in v) eu[k].value.copy(v);
      else eu[k].value = v;
    }
    eu.showSunDisc.value = 0;
    envScene.add(envSky);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(900, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.11, 0.13, 0.07) }),
    );
    ground.position.y = -2;
    envScene.add(ground);
    const env = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
    envSky.material.dispose();

    this.fogColor.setRGB(0.47, 0.6, 0.76);
    scene.fog = new THREE.FogExp2(this.fogColor, 0.00062);

    this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.78), 5.2);
    this.sun.castShadow = q.shadows;
    this.shadowRange = q.shadowRange;
    const sc = this.sun.shadow.camera;
    sc.left = -q.shadowRange;
    sc.right = q.shadowRange;
    sc.top = q.shadowRange;
    sc.bottom = -q.shadowRange;
    sc.near = 1;
    sc.far = 520;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.62, 0.76, 1.0), new THREE.Color(0.3, 0.27, 0.2), 0.8);
    scene.add(this.hemi);

    this.waterMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          tNormal: { value: null },
          tHeight: { value: null },
          tNoise: { value: null },
          uSunDir: { value: this.sunDir.clone() },
          uSunColor: { value: new THREE.Color(1.0, 0.9, 0.72) },
          uDeep: { value: new THREE.Color(0.012, 0.075, 0.13) },
          uShallow: { value: new THREE.Color(0.1, 0.42, 0.44) },
          uSkyHorizon: { value: new THREE.Color(0.55, 0.68, 0.8) },
          uSkyZenith: { value: new THREE.Color(0.12, 0.3, 0.62) },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        #include <common>
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D tNormal; uniform sampler2D tHeight; uniform sampler2D tNoise;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uDeep; uniform vec3 uShallow;
        uniform vec3 uSkyHorizon; uniform vec3 uSkyZenith;
        varying vec3 vWPos;
        #include <common>
        #include <fog_pars_fragment>
        void main(){
          vec2 p = vWPos.xz;
          float dist = length(cameraPosition - vWPos);
          vec3 n1 = texture2D(tNormal, p * 0.031 + vec2(uTime * 0.013, uTime * 0.009)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormal, p * 0.0093 - vec2(uTime * 0.006, -uTime * 0.008)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(tNormal, p * 0.127 + vec2(-uTime * 0.03, uTime * 0.021)).xyz * 2.0 - 1.0;
          float detail = 1.0 - smoothstep(40.0, 420.0, dist);
          vec2 sl = n1.xy * 0.5 + n2.xy * 0.75 + n3.xy * 0.35 * detail;
          float calm = mix(1.0, 0.35, smoothstep(300.0, 2500.0, dist));
          vec3 nn = normalize(vec3(sl.x * 0.42 * calm, 1.0, sl.y * 0.42 * calm));
          vec3 V = normalize(cameraPosition - vWPos);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nn, V), 0.0), 5.0);
          vec3 R = reflect(-V, nn);
          R.y = abs(R.y);
          vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(max(R.y, 0.0), 0.5));
          float sd = max(dot(R, uSunDir), 0.0);
          float spec = pow(sd, 420.0) * 9.0 + pow(sd, 48.0) * 0.35;
          vec2 huv = p / ${WORLD_SIZE.toFixed(1)} + 0.5;
          float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
          float h = texture2D(tHeight, clamp(huv, 0.0, 1.0)).r;
          float depth = mix(16.0, max(-h, 0.0), inside);
          vec3 body = mix(uDeep, uShallow, exp(-depth * 0.5));
          body *= 0.3 + 0.7 * max(uSunDir.y, 0.0);
          vec3 col = mix(body, sky, fres) + uSunColor * spec;
          float foamN = texture2D(tNoise, p * 0.07 + vec2(uTime * 0.018, 0.0)).r;
          float foamN2 = texture2D(tNoise, p * 0.23 - vec2(0.0, uTime * 0.03)).g;
          float wave = sin(depth * 4.2 - uTime * 1.5 + foamN * 6.2831) * 0.5 + 0.5;
          float foam = (1.0 - smoothstep(0.0, 0.75, depth)) * smoothstep(0.42, 0.78, foamN * 0.6 + foamN2 * 0.4 + wave * 0.32);
          col = mix(col, vec3(0.86, 0.92, 0.95) * (0.45 + 0.55 * uSunDir.y), clamp(foam, 0.0, 1.0) * 0.85);
          float alpha = clamp(max(fres, 1.0 - exp(-depth * 1.5)) + foam * 0.6, 0.0, 1.0);
          alpha = max(alpha, smoothstep(0.0, 0.05, depth) * 0.2);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.waterMat.uniforms.tNormal.value = tex.waterNormal;
    this.waterMat.uniforms.tHeight.value = heightTex;
    this.waterMat.uniforms.tNoise.value = tex.noise;
    const wg = new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.y = 0;
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;
    scene.add(this.water);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.waterMat.uniforms.uTime.value = this.time;
    this.sky.material.uniforms.time.value = this.time;
    this.sky.position.copy(camera.position);
    this.sunSprite.position.copy(camera.position).addScaledVector(this.sunDir, 2000);
    this.water.position.x = camera.position.x;
    this.water.position.z = camera.position.z;

    // keep the shadow frustum centred slightly ahead of the camera, snapped to texels
    camera.getWorldDirection(_c);
    _c.y = 0;
    if (_c.lengthSq() > 1e-6) _c.normalize();
    const r = this.shadowRange;
    _c.multiplyScalar(r * 0.55).add(camera.position);
    _right.crossVectors(this.sunDir, UP).normalize();
    _up.crossVectors(_right, this.sunDir).normalize();
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const cr = Math.round(_c.dot(_right) / texel) * texel;
    const cu = Math.round(_c.dot(_up) / texel) * texel;
    const cf = _c.dot(this.sunDir);
    _c.set(0, 0, 0).addScaledVector(_right, cr).addScaledVector(_up, cu).addScaledVector(this.sunDir, cf);
    this.sun.target.position.copy(_c);
    this.sun.position.copy(_c).addScaledVector(this.sunDir, 260);
    this.sun.target.updateMatrixWorld();
  }
}
