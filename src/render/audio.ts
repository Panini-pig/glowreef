/**
 * 极简程序化音效：不加载任何外部资源，全部用 WebAudio 合成。
 * 深海感 = 低频正弦 + 短促噪声 + 长衰减。
 */
import type { SpellId } from '../sim/types.ts';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastSpawn = 0;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  unlock(): void {
    this.ensure();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.16;
    return this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    delay = 0,
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterHz: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  select(): void {
    this.tone(520, 0.07, 'sine', 0.5, 780);
  }

  send(): void {
    const now = performance.now();
    if (now - this.lastSpawn < 110) return;
    this.lastSpawn = now;
    this.tone(300, 0.16, 'sine', 0.32, 620);
    this.noise(0.09, 0.12, 900);
  }

  hit(): void {
    this.tone(150, 0.1, 'triangle', 0.3, 90);
  }

  capture(): void {
    this.tone(523, 0.16, 'sine', 0.34);
    this.tone(784, 0.28, 'sine', 0.3, undefined, 0.07);
    this.noise(0.22, 0.1, 1800);
  }

  upgrade(): void {
    [660, 880, 1100].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.26, undefined, i * 0.05));
  }

  brew(): void {
    this.tone(200, 0.18, 'sine', 0.22, 150);
    this.tone(300, 0.22, 'sine', 0.16, 240, 0.06);
  }

  potion(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.24, undefined, i * 0.055));
  }

  cast(spell: SpellId): void {
    if (spell === 'freeze') this.tone(900, 0.22, 'sine', 0.22, 1500);
    else if (spell === 'infect') this.tone(180, 0.26, 'sawtooth', 0.14, 110);
    else this.tone(320, 0.3, 'triangle', 0.2, 760);
    this.noise(0.12, 0.08, 1600);
  }

  freeze(): void {
    this.tone(1200, 0.2, 'sine', 0.2, 1900);
    this.noise(0.16, 0.1, 3200);
  }

  infect(): void {
    this.tone(120, 0.34, 'sawtooth', 0.12, 70);
    this.noise(0.2, 0.06, 700);
  }

  deny(): void {
    this.tone(180, 0.12, 'square', 0.12, 120);
  }

  result(win: boolean): void {
    const notes = win ? [392, 523, 659, 784] : [330, 262, 220, 165];
    notes.forEach((f, i) => this.tone(f, 0.5, 'sine', 0.26, undefined, i * 0.12));
  }
}
