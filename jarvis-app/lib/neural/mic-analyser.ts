/**
 * MicAnalyser — taps the live microphone stream while JARVIS is listening and
 * reports a 0..1 loudness level (plus peak flags) so the neuron brain can pulse
 * in time with the user's actual voice.
 *
 * Uses the Web Audio API (getUserMedia → AnalyserNode). Runs alongside
 * SpeechRecognition, which manages its own capture. If mic access fails it
 * resolves to false and the caller falls back to the static listening state.
 */

export class MicAnalyser {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;
  private lastPeak = 0;

  async start(onLevel: (level: number, peak: boolean) => void): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false;
    }
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;

    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.analyser || !this.data) return;
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.data.length); // 0..~1
      const level = Math.min(1, rms * 3.4); // scale up typical speech energy
      const now = performance.now();
      const peak = level > 0.32 && now - this.lastPeak > 110;
      if (peak) this.lastPeak = now;
      onLevel(level, peak);
    };
    loop();
    return true;
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    this.data = null;
  }
}
