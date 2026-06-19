/**
 * HudSound — synthesized Stark-style UI sound design for the JARVIS HUD.
 *
 * All sounds are generated procedurally with the Web Audio API (oscillators,
 * gain envelopes, filtered noise) — no audio files. An AudioContext can only
 * start after a user gesture, so call unlock() from a click before playing.
 *
 * Fully optional: if AudioContext is unavailable everything no-ops and the
 * visuals/voice still work.
 */

export class HudSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientOscs: OscillatorNode[] = [];

  /** Create/resume the AudioContext. Must run inside a user gesture. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private get t() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }) {
    if (!this.ctx || !this.master) return;
    const { freq, to, dur, type = "sine", gain = 0.2, delay = 0 } = opts;
    const start = this.t + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.04, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private noiseBurst(opts: { dur: number; gain?: number; cutoffFrom?: number; cutoffTo?: number; delay?: number }) {
    if (!this.ctx || !this.master) return;
    const { dur, gain = 0.18, cutoffFrom = 400, cutoffTo = 6000, delay = 0 } = opts;
    const start = this.t + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(cutoffFrom, start);
    filter.frequency.exponentialRampToValueAtTime(cutoffTo, start + dur);
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  /** Short high tick — UI confirmation. */
  blip() {
    this.tone({ freq: 1320, dur: 0.06, type: "triangle", gain: 0.1 });
  }

  /** Cinematic power-on: low hum sweep + rising tone + airy noise swell. */
  boot() {
    this.tone({ freq: 48, to: 120, dur: 2.0, type: "sine", gain: 0.22 });
    this.tone({ freq: 180, to: 720, dur: 1.6, type: "triangle", gain: 0.12, delay: 0.15 });
    this.noiseBurst({ dur: 1.8, gain: 0.06, cutoffFrom: 200, cutoffTo: 4000 });
    this.tone({ freq: 880, to: 1320, dur: 0.5, type: "sine", gain: 0.1, delay: 1.7 });
  }

  /** Greeting flare: rising saw + shimmer + whoosh. */
  powerUp() {
    this.tone({ freq: 160, to: 1200, dur: 0.55, type: "sawtooth", gain: 0.14 });
    this.tone({ freq: 520, to: 1568, dur: 0.6, type: "sine", gain: 0.1, delay: 0.05 });
    this.noiseBurst({ dur: 0.5, gain: 0.16, cutoffFrom: 800, cutoffTo: 8000 });
  }

  /** A soft, low holographic drone for the live HUD. */
  startAmbient() {
    if (!this.ctx || !this.master || this.ambientGain) return;
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0.0001, this.t);
    this.ambientGain.gain.exponentialRampToValueAtTime(0.05, this.t + 2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    this.ambientGain.connect(this.master);
    filter.connect(this.ambientGain);
    [55, 82.4, 110].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = i === 2 ? "triangle" : "sine";
      osc.frequency.value = f;
      osc.detune.value = (i - 1) * 6;
      osc.connect(filter);
      osc.start();
      this.ambientOscs.push(osc);
    });
  }

  stopAmbient() {
    if (!this.ctx || !this.ambientGain) return;
    const g = this.ambientGain;
    g.gain.cancelScheduledValues(this.t);
    g.gain.setValueAtTime(g.gain.value, this.t);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + 0.6);
    const oscs = this.ambientOscs;
    setTimeout(() => oscs.forEach((o) => o.stop()), 800);
    this.ambientOscs = [];
    this.ambientGain = null;
  }

  dispose() {
    this.stopAmbient();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
}
