import { clamp } from '../core/math';

/**
 * Everything you hear is synthesised with the Web Audio API: filtered noise
 * bursts for gunfire and impacts, oscillators for UI, looping noise beds for
 * wind and the transport aircraft. No audio files are shipped.
 */
export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private rx = 1;
  private rz = 0;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private engine: { gain: GainNode; osc: OscillatorNode } | null = null;
  private ambience: GainNode | null = null;
  volume = 0.8;

  /** must be called from a user gesture */
  resume(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startBeds();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private startBeds(): void {
    const ctx = this.ctx!;
    // wind / rushing air
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.wind = { gain: g, filter: f };
    // soft outdoor ambience
    const a = ctx.createBufferSource();
    a.buffer = this.noise;
    a.loop = true;
    const af = ctx.createBiquadFilter();
    af.type = 'lowpass';
    af.frequency.value = 420;
    const ag = ctx.createGain();
    ag.gain.value = 0.02;
    a.connect(af).connect(ag).connect(this.master!);
    a.start();
    this.ambience = ag;
    // aircraft drone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 72;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 109;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 380;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    osc.connect(ef);
    osc2.connect(ef);
    ef.connect(eg).connect(this.master!);
    osc.start();
    osc2.start();
    this.engine = { gain: eg, osc };
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    // right vector for a +Z-forward yaw convention
    this.rx = -Math.cos(yaw);
    this.rz = Math.sin(yaw);
  }
  setWind(level: number): void {
    if (!this.wind || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.5, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(300 + level * 900, t, 0.2);
  }
  setEngine(level: number): void {
    if (!this.engine || !this.ctx) return;
    this.engine.gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.16, this.ctx.currentTime, 0.3);
  }
  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** distance attenuation + stereo placement for a world position */
  private place(x: number, y: number, z: number, range: number): { gain: number; pan: number; delay: number; dist: number } {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const dist = Math.hypot(dx, dy, dz);
    const k = dist / range;
    const gain = k >= 1 ? 0 : (1 - k) * (1 - k) / (1 + (dist / 14) * (dist / 14) * 0.35);
    const pan = dist > 0.5 ? clamp((dx * this.rx + dz * this.rz) / dist, -1, 1) : 0;
    return { gain, pan, delay: Math.min(1.5, dist / 343), dist };
  }

  private burst(
    when: number, dur: number, freq: number, q: number, gain: number, pan: number, type: BiquadFilterType = 'bandpass', sweepTo = 0,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    if (sweepTo > 0) f.frequency.exponentialRampToValueAtTime(sweepTo, when + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master!);
    src.start(when, Math.random() * 1.2);
    src.stop(when + dur + 0.05);
  }

  private tone(when: number, dur: number, f0: number, f1: number, gain: number, pan = 0, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master!);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  shot(kind: string, x: number, y: number, z: number, own: boolean): void {
    if (!this.ctx) return;
    const pl = own ? { gain: 1, pan: 0.12, delay: 0, dist: 0 } : this.place(x, y, z, 620);
    if (pl.gain < 0.004) return;
    const t = this.ctx.currentTime + pl.delay;
    const far = clamp(pl.dist / 220, 0, 1);
    const g = pl.gain * (own ? 0.55 : 0.9);
    let body = 0.16;
    let freq = 1500;
    let thump = 130;
    let level = 1;
    switch (kind) {
      case 'pistol': body = 0.11; freq = 2100; thump = 170; level = 0.75; break;
      case 'smg': body = 0.09; freq = 2400; thump = 190; level = 0.7; break;
      case 'ar': body = 0.15; freq = 1500; thump = 135; break;
      case 'shotgun': body = 0.3; freq = 750; thump = 85; level = 1.25; break;
      case 'dmr': body = 0.24; freq = 1150; thump = 105; level = 1.15; break;
      case 'sniper': body = 0.42; freq = 820; thump = 70; level = 1.4; break;
    }
    // distant shots lose their crack and become a dull thud
    const f = freq * (1 - far * 0.82);
    this.burst(t, body * (1 + far * 1.6), f, 0.7, g * level * 1.5, pl.pan, 'bandpass', f * 0.3);
    this.tone(t, body * 0.7, thump * 1.6, thump * 0.42, g * level * 1.1, pl.pan);
    if (far < 0.5) this.burst(t, 0.03, 5200, 0.5, g * level * (1 - far * 2) * 0.9, pl.pan, 'highpass');
    if (far > 0.25) this.burst(t + 0.06, body * 3.5, 320, 0.4, g * level * far * 0.6, pl.pan, 'lowpass');
  }

  impact(surf: number, x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const pl = this.place(x, y, z, 70);
    if (pl.gain < 0.01) return;
    const t = this.ctx.currentTime + pl.delay;
    if (surf === 3) {
      this.tone(t, 0.12, 1900 + Math.random() * 900, 900, pl.gain * 0.35, pl.pan, 'triangle');
      this.burst(t, 0.05, 4200, 2, pl.gain * 0.4, pl.pan);
    } else if (surf === 5) this.burst(t, 0.18, 1400, 0.8, pl.gain * 0.35, pl.pan, 'bandpass', 400);
    else if (surf === 6) this.burst(t, 0.07, 620, 1.2, pl.gain * 0.5, pl.pan, 'lowpass');
    else this.burst(t, 0.07, surf === 1 ? 900 : 1700, 1.1, pl.gain * 0.45, pl.pan);
  }

  whiz(pan: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.16, 3600, 4, 0.22, pan, 'bandpass', 1300);
  }

  footstep(x: number, y: number, z: number, own: boolean, hard: boolean): void {
    if (!this.ctx) return;
    const pl = own ? { gain: 0.5, pan: 0, delay: 0, dist: 0 } : this.place(x, y, z, 34);
    if (pl.gain < 0.02) return;
    const t = this.ctx.currentTime;
    this.burst(t, hard ? 0.05 : 0.08, hard ? 900 : 380, 0.9, pl.gain * (own ? 0.16 : 0.5), pl.pan, 'lowpass');
    if (hard) this.tone(t, 0.04, 180, 90, pl.gain * 0.12, pl.pan);
  }

  explosion(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const pl = this.place(x, y, z, 900);
    const t = this.ctx.currentTime + pl.delay;
    const g = Math.max(0.05, pl.gain);
    this.burst(t, 1.3, 520, 0.4, g * 2.4, pl.pan, 'lowpass', 60);
    this.tone(t, 0.7, 95, 28, g * 2.2, pl.pan);
    this.burst(t, 0.12, 2600, 0.5, g * 1.2, pl.pan, 'highpass');
  }

  ui(kind: 'pickup' | 'equip' | 'reload' | 'reloadDone' | 'empty' | 'hit' | 'head' | 'kill' | 'hurt' | 'heal' | 'zone' | 'chute' | 'click' | 'land' | 'win' | 'pin' | 'throw'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'pickup':
        this.tone(t, 0.07, 620, 880, 0.12, 0, 'triangle');
        this.burst(t, 0.05, 2400, 1.5, 0.08, 0);
        break;
      case 'equip':
        this.burst(t, 0.06, 1500, 2, 0.16, 0);
        this.burst(t + 0.07, 0.04, 2600, 3, 0.12, 0);
        break;
      case 'reload':
        this.burst(t, 0.05, 1900, 3, 0.2, 0);
        this.tone(t + 0.02, 0.05, 300, 180, 0.08);
        break;
      case 'reloadDone':
        this.burst(t, 0.04, 2800, 4, 0.2, 0);
        this.burst(t + 0.09, 0.05, 1700, 3, 0.24, 0);
        break;
      case 'empty':
        this.burst(t, 0.025, 3200, 5, 0.16, 0);
        break;
      case 'hit':
        this.tone(t, 0.045, 1250, 950, 0.13, 0, 'square');
        break;
      case 'head':
        this.tone(t, 0.09, 1900, 1500, 0.16, 0, 'square');
        this.tone(t + 0.03, 0.12, 2800, 2400, 0.1, 0, 'triangle');
        break;
      case 'kill':
        this.tone(t, 0.12, 660, 660, 0.14, 0, 'triangle');
        this.tone(t + 0.1, 0.2, 990, 990, 0.14, 0, 'triangle');
        break;
      case 'hurt':
        this.burst(t, 0.12, 300, 0.8, 0.4, 0, 'lowpass');
        this.tone(t, 0.14, 150, 70, 0.3);
        break;
      case 'heal':
        this.tone(t, 0.16, 520, 780, 0.1, 0, 'sine');
        this.tone(t + 0.12, 0.22, 780, 1040, 0.1, 0, 'sine');
        break;
      case 'zone':
        this.tone(t, 0.35, 440, 440, 0.12, 0, 'sawtooth');
        this.tone(t + 0.4, 0.35, 330, 330, 0.12, 0, 'sawtooth');
        break;
      case 'chute':
        this.burst(t, 0.5, 700, 0.5, 0.5, 0, 'lowpass', 200);
        break;
      case 'click':
        this.tone(t, 0.03, 900, 700, 0.08, 0, 'triangle');
        break;
      case 'land':
        this.burst(t, 0.16, 260, 0.7, 0.5, 0, 'lowpass');
        this.tone(t, 0.12, 120, 55, 0.3);
        break;
      case 'pin':
        this.burst(t, 0.03, 4200, 6, 0.2, 0);
        this.tone(t + 0.03, 0.06, 2400, 2000, 0.06, 0, 'triangle');
        break;
      case 'throw':
        this.burst(t, 0.18, 900, 0.8, 0.14, 0, 'bandpass', 2200);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.14, 0.4, f, f, 0.14, 0, 'triangle'));
        break;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    void this.ambience;
  }
}
