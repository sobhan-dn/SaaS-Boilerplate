import * as THREE from 'three';

/**
 * Fully procedural sound design (no audio assets): engines, boost, splashes, hits, pickups, goal fanfare.
 * Distance attenuation is computed against the listener (camera) position.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engines = new Map<number, { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; boostGain: GainNode; boostSrc: AudioBufferSourceNode }>();
  private listener = new THREE.Vector3();
  private lastSplash = 0;
  muted = false;

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setListener(p: THREE.Vector3) {
    this.listener.copy(p);
  }

  private falloff(p?: THREE.Vector3, ref = 18) {
    if (!p) return 1;
    const d = p.distanceTo(this.listener);
    return Math.min(1, ref / Math.max(ref, d));
  }

  private noiseSource(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = true;
    return s;
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /* -------------------- engines -------------------- */

  ensureEngine(id: number) {
    if (!this.ctx || !this.master || this.engines.has(id)) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc2.start();
    const boostSrc = this.noiseSource();
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 900;
    bf.Q.value = 0.7;
    const boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    boostSrc.connect(bf);
    bf.connect(boostGain);
    boostGain.connect(this.master);
    boostSrc.start();
    this.engines.set(id, { osc, osc2, gain, filter, boostGain, boostSrc });
  }

  updateEngine(id: number, throttle: number, speed: number, boosting: boolean, inWater: boolean, pos: THREE.Vector3, isPlayer: boolean) {
    const e = this.engines.get(id);
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + Math.abs(throttle) * 0.45 + Math.min(1, speed / 30) * 0.5 + (boosting ? 0.35 : 0);
    const base = 55 + rpm * 110;
    e.osc.frequency.setTargetAtTime(base, t, 0.08);
    e.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    e.filter.frequency.setTargetAtTime(300 + rpm * 900 + (inWater ? 0 : 500), t, 0.1);
    const vol = (0.035 + rpm * 0.05) * (isPlayer ? 1 : 0.55) * this.falloff(pos, 22) * (this.muted ? 0 : 1);
    e.gain.gain.setTargetAtTime(vol, t, 0.1);
    const bv = boosting ? 0.11 * (isPlayer ? 1 : 0.5) * this.falloff(pos, 22) : 0;
    e.boostGain.gain.setTargetAtTime(this.muted ? 0 : bv, t, 0.06);
  }

  /* -------------------- one-shots -------------------- */

  splash(strength: number, pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    if (t - this.lastSplash < 0.05) return;
    this.lastSplash = t;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600 + strength * 500, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.35 + strength * 0.2);
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    this.env(g, t, 0.25 * Math.min(1.3, strength) * this.falloff(pos), 0.015, 0.35 + strength * 0.25);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 1);
  }

  hit(strength: number, pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const a = this.falloff(pos, 26);
    // thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 + strength * 40, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = this.ctx.createGain();
    this.env(g, t, 0.45 * Math.min(1.2, strength) * a, 0.005, 0.22);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
    // rubbery "boing"
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(320, t);
    osc2.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    const g2 = this.ctx.createGain();
    this.env(g2, t, 0.12 * Math.min(1, strength) * a, 0.005, 0.14);
    osc2.connect(g2);
    g2.connect(this.master);
    osc2.start(t);
    osc2.stop(t + 0.2);
    // slap noise
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    const g3 = this.ctx.createGain();
    this.env(g3, t, 0.08 * Math.min(1, strength) * a, 0.002, 0.08);
    src.connect(f);
    f.connect(g3);
    g3.connect(this.master);
    src.start(t);
    src.stop(t + 0.15);
  }

  jump(pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.12 * this.falloff(pos), 0.01, 0.16);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  dodge(pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t, 0.14 * this.falloff(pos), 0.01, 0.25);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
  }

  boostPickup(big: boolean, pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const notes = big ? [523, 659, 784, 1047] : [784, 1047];
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx!.createGain();
      this.env(g, t + i * 0.05, 0.09 * this.falloff(pos), 0.01, 0.18);
      osc.connect(g);
      g.connect(this.master!);
      osc.start(t + i * 0.05);
      osc.stop(t + i * 0.05 + 0.25);
    });
  }

  morph(pos?: THREE.Vector3) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.15);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    const g = this.ctx.createGain();
    this.env(g, t, 0.2 * this.falloff(pos, 40), 0.01, 0.35);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  countdown(final: boolean) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = final ? 880 : 440;
    const g = this.ctx.createGain();
    this.env(g, t, 0.1, 0.005, final ? 0.5 : 0.15);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  goal() {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = i < 4 ? 'triangle' : 'sawtooth';
      osc.frequency.value = f;
      const g = this.ctx!.createGain();
      this.env(g, t + i * 0.11, 0.14, 0.01, 0.3);
      osc.connect(g);
      g.connect(this.master!);
      osc.start(t + i * 0.11);
      osc.stop(t + i * 0.11 + 0.4);
    });
    // crowd swell
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 3.5);
  }

  whistle() {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, t);
    osc.frequency.linearRampToValueAtTime(2600, t + 0.4);
    const g = this.ctx.createGain();
    this.env(g, t, 0.12, 0.02, 0.6);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }
}
