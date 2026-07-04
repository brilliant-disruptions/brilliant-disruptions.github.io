/**
 * AirHockeyGame — a neon Canvas 2D air hockey game with a CPU opponent.
 *
 * Ported from https://codepen.io/michaeljwilt/pen/MYJORbg (Matt Cannon,
 * "Air Hockey"). Framework-agnostic: construct with a <canvas> and a
 * callbacks object, call init(), drive with startGame()/toggleMute(), and
 * dispose() on unmount. Used by the React page at
 * app/(app)/air-hockey/page.tsx, which owns score/stats/mute/game-over UI
 * state fed by the callbacks below — everything else (table, puck, mallets,
 * particles, confetti, slo-mo drama) stays inside this class exactly as in
 * the original pen.
 */

export type SideStats = { streak: number; topSpeed: number; powerHits: number };
export type GameOverResult = { winner: "p" | "cpu"; final: string } | null;
export type AirHockeyCallbacks = {
  onStats: (stats: { p: SideStats; cpu: SideStats }) => void;
  onScore: (score: { p: number; cpu: number }) => void;
  onGameOver: (result: GameOverResult) => void;
  onMuteChange: (muted: boolean) => void;
};

// Colors seeded from jarvis-app/app/globals.css: --cyan, --danger, --gold.
const CYAN = "#00e5ff";
const DANGER = "#ff4d6d";
const GOLD = "#ffb347";
const CONF_COLORS = [CYAN, DANGER, GOLD, "#ffffff", "#a855f7", "#22c55e", "#fb923c"];

const W = 760;
const H = 520;
const TABLE_X = 30;
const TABLE_Y = 30;
const TABLE_W = W - 60;
const TABLE_H = H - 60;
const CX = W / 2;
const CY = H / 2;
const GOAL_W = 160;
const GOAL_DEPTH = 20;
const GOAL_Y1 = CY - GOAL_W / 2;
const GOAL_Y2 = CY + GOAL_W / 2;
const PUCK_R = 14;
const MALLET_R = 24;
const MAX_SCORE = 7;
const FRICTION = 0.995;
const WALL_BOUNCE = 0.82;

const CPU_SPEED = 4.6;
const CPU_REACT = 0.62;
const CPU_ERROR_Y = 26;
const CPU_MISTAKE_CHANCE = 0.018;
const CPU_MISTAKE_DUR = 42;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

type Particle = {
  x: number; y: number; vx: number; vy: number; life: number;
  col: string; size: number; glow: boolean; gravity: number;
};
type Confetto = {
  x: number; y: number; vx: number; vy: number; rot: number; rotV: number;
  w: number; h: number; col: string; life: number;
};
type TrailPoint = { x: number; y: number; spd: number };
type Mallet = { x: number; y: number; r: number; pvx: number; pvy: number };
type Cpu = { x: number; y: number; r: number; vx: number; vy: number; mistakeTimer: number; errorY: number; hitCool: number };
type GameState = "title" | "play" | "goal" | "over";

export class AirHockeyGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: AirHockeyCallbacks;
  private raf = 0;
  private disposed = false;

  private state: GameState = "title";
  private tick = 0;

  private audioCtx: AudioContext | null = null;
  private muted = true;

  private shakeX = 0;
  private shakeY = 0;
  private shakeAmt = 0;
  private goalFlash = 0;
  private goalWho: "p" | "cpu" = "p";
  private goalMsgScale = 0;
  private puckSpeedMult = 1.0;
  private lastSpeedUpAt = 0;
  private speedUpMsg = "";
  private speedUpTimer = 0;
  private showSadFace = false;
  private sloMo = false;
  private sloMoAlpha = 0;
  private sloMoIntro = 0;
  private sloMoLabelTimer = 0;
  private confettiInterval: ReturnType<typeof setInterval> | null = null;

  private stats = {
    p: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
    cpu: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
    rallyHits: 0,
    totalHits: 0,
  };
  private score = { p: 0, cpu: 0 };
  private puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R };
  private trail: TrailPoint[] = [];
  private player: Mallet = { x: TABLE_X + 130, y: CY, r: MALLET_R, pvx: 0, pvy: 0 };
  private cpu: Cpu = { x: W - TABLE_X - 130, y: CY, r: MALLET_R, vx: 0, vy: 0, mistakeTimer: 0, errorY: 0, hitCool: 0 };
  private particles: Particle[] = [];
  private confetti: Confetto[] = [];

  private rawMouseX = TABLE_X + 120;
  private rawMouseY = H / 2;
  private prevRawX = TABLE_X + 120;
  private prevRawY = H / 2;
  private mouseVX = 0;
  private mouseVY = 0;

  private onMouseMove = (e: MouseEvent) => this.pointerToCanvas(e.clientX, e.clientY);
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    this.pointerToCanvas(e.touches[0].clientX, e.touches[0].clientY);
  };
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    this.pointerToCanvas(e.touches[0].clientX, e.touches[0].clientY);
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyS") this.toggleMute();
    if (e.code === "Space" && this.state === "over") this.startGame();
  };

  constructor(canvas: HTMLCanvasElement, callbacks: AirHockeyCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("AirHockeyGame: canvas 2d context unavailable");
    this.ctx = ctx;
  }

  init() {
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    document.addEventListener("keydown", this.onKeyDown);
    this.startGame();
    this.loop();
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("touchmove", this.onTouchMove);
    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.confettiInterval) clearInterval(this.confettiInterval);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted) this.getAudio().resume();
    this.callbacks.onMuteChange(this.muted);
  }

  startGame() {
    this.score.p = 0;
    this.score.cpu = 0;
    this.stats = {
      p: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
      cpu: { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 },
      rallyHits: 0,
      totalHits: 0,
    };
    this.puckSpeedMult = 1.0;
    this.lastSpeedUpAt = 0;
    this.speedUpMsg = "";
    this.speedUpTimer = 0;
    this.sloMo = false;
    this.sloMoAlpha = 0;
    this.sloMoIntro = 0;
    this.sloMoLabelTimer = 0;
    this.confetti.length = 0;
    if (this.confettiInterval) {
      clearInterval(this.confettiInterval);
      this.confettiInterval = null;
    }
    this.showSadFace = false;
    this.resetRound("p");
    this.state = "play";
    this.particles.length = 0;
    this.callbacks.onGameOver(null);
    this.reportStats();
  }

  private pointerToCanvas(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const scaleX = W / r.width, scaleY = H / r.height;
    const nx = (clientX - r.left) * scaleX;
    const ny = (clientY - r.top) * scaleY;
    this.rawMouseX = clamp(nx, TABLE_X + MALLET_R + 2, CX - 10);
    this.rawMouseY = clamp(ny, TABLE_Y + MALLET_R + 2, TABLE_Y + TABLE_H - MALLET_R - 2);
  }

  // ── Audio engine ──
  private getAudio(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    return this.audioCtx;
  }

  private mkNoise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
    const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
  }

  private playSound(type: "hit" | "wall" | "goal" | "victory" | "speedup" | "slomo_in", speed = 1) {
    if (this.muted) return;
    const ctx = this.getAudio();
    const t = ctx.currentTime;
    const out = ctx.destination;
    if (type === "hit") {
      const n = this.mkNoise(ctx, 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900 + speed * 180 + Math.random() * 400;
      bp.Q.value = 2 + Math.random() * 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 + Math.min(speed / 18, 0.35), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(bp); bp.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.07);
    }
    if (type === "wall") {
      const n = this.mkNoise(ctx, 0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400 + Math.random() * 600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      n.connect(hp); hp.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.04);
    }
    if (type === "goal") {
      const sub = ctx.createOscillator(), sg = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.25);
      sg.gain.setValueAtTime(0.6, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      sub.connect(sg); sg.connect(out);
      sub.start(t); sub.stop(t + 0.3);
      ([[0, "sawtooth", 233], [0.01, "sawtooth", 220], [0.02, "sawtooth", 246]] as const).forEach(([dt, wv, f]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = wv;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.15, t + dt);
        g.gain.setValueAtTime(0.15, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g); g.connect(out);
        o.start(t + dt); o.stop(t + 0.71);
      });
    }
    if (type === "victory") {
      ([[0, 392, 0.12], [0.13, 392, 0.12], [0.26, 392, 0.12], [0.39, 523, 0.45], [0.58, 494, 0.18], [0.77, 440, 0.18], [0.96, 523, 0.6]] as const).forEach(([dt, f, dur]) => {
        [-4, 0, 4].forEach((cents) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sawtooth";
          o.frequency.value = f * Math.pow(2, cents / 1200);
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 1800;
          g.gain.setValueAtTime(0, t + dt);
          g.gain.linearRampToValueAtTime(0.08, t + dt + 0.02);
          g.gain.setValueAtTime(0.08, t + dt + dur - 0.03);
          g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur);
          o.connect(lp); lp.connect(g); g.connect(out);
          o.start(t + dt); o.stop(t + dt + dur + 0.01);
        });
      });
    }
    if (type === "speedup") {
      const n = this.mkNoise(ctx, 0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 5;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(3000, t + 0.38);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      n.connect(bp); bp.connect(g); g.connect(out);
      n.start(t); n.stop(t + 0.4);
    }
    if (type === "slomo_in") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.65);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.7);
    }
  }

  // ── Particles / confetti ──
  private burst(x: number, y: number, col1: string, col2: string, n = 22) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 7;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1,
        col: Math.random() > 0.5 ? col1 : col2,
        size: 2 + Math.random() * 4,
        glow: Math.random() > 0.4,
        gravity: 0.08 + Math.random() * 0.12,
      });
    }
  }

  private sparkLine(x1: number, y1: number, x2: number, y2: number, col: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 10;
      const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 10;
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1,
        col, size: 1.5 + Math.random() * 2, glow: true, gravity: 0.1,
      });
    }
  }

  private spawnConfetti() {
    for (let i = 0; i < 160; i++) {
      this.confetti.push({
        x: Math.random() * W, y: -10 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.22,
        w: 6 + Math.random() * 8, h: 3 + Math.random() * 4,
        col: CONF_COLORS[Math.floor(Math.random() * CONF_COLORS.length)],
        life: 1,
      });
    }
  }

  private updateConfetti() {
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.x += c.vx; c.y += c.vy; c.vy += 0.08; c.vx *= 0.99; c.rot += c.rotV;
      if (c.y > H + 20) c.life -= 0.05;
      if (c.life <= 0) this.confetti.splice(i, 1);
    }
  }

  private shake(amt: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  private reportStats() {
    this.callbacks.onStats({
      p: { streak: this.stats.p.bestStreak, topSpeed: this.stats.p.topSpeed, powerHits: this.stats.p.powerHits },
      cpu: { streak: this.stats.cpu.bestStreak, topSpeed: this.stats.cpu.topSpeed, powerHits: this.stats.cpu.powerHits },
    });
    this.callbacks.onScore({ p: this.score.p, cpu: this.score.cpu });
  }

  // ── Game flow ──
  private resetRound(server: "p" | "cpu") {
    this.trail.length = 0;
    this.puck.x = CX; this.puck.y = CY; this.puck.vx = 0; this.puck.vy = 0;
    this.player.x = TABLE_X + 120; this.player.y = CY; this.player.pvx = 0; this.player.pvy = 0;
    this.cpu.x = W - TABLE_X - 120; this.cpu.y = CY; this.cpu.vx = 0; this.cpu.vy = 0;
    this.cpu.mistakeTimer = 0;
    this.stats.rallyHits = 0;
    if (server === "p") {
      this.puck.vx = -(3.5 + Math.random() * 1.5) * this.puckSpeedMult;
      this.puck.vy = (Math.random() - 0.5) * 3.5 * this.puckSpeedMult;
    } else {
      this.puck.vx = (3.5 + Math.random() * 1.5) * this.puckSpeedMult;
      this.puck.vy = (Math.random() - 0.5) * 3.5 * this.puckSpeedMult;
    }
  }

  private goalScored(who: "p" | "cpu") {
    if (this.state !== "play") return;
    this.state = "goal";
    this.goalWho = who;
    this.goalFlash = 160;
    this.goalMsgScale = 0;

    const ws = this.stats[who], ls = this.stats[who === "p" ? "cpu" : "p"];
    ws.goals++; ws.streak++; ws.bestStreak = Math.max(ws.bestStreak, ws.streak); ls.streak = 0;

    this.score[who]++;
    const totalGoals = this.score.p + this.score.cpu;
    if (totalGoals % 2 === 0 && totalGoals > this.lastSpeedUpAt) {
      this.lastSpeedUpAt = totalGoals;
      this.puckSpeedMult = Math.min(this.puckSpeedMult + 0.14, 2.0);
      const msgs = ["SPEEDING UP!", "FASTER!!", "KICK IT UP!", "NO MERCY!", "LIGHT SPEED!", "HOLD ON!!"];
      this.speedUpMsg = msgs[Math.min(Math.floor(totalGoals / 2 - 1), msgs.length - 1)];
      this.speedUpTimer = 130;
      this.playSound("speedup");
    }
    if (who === "p") this.burst(TABLE_X, CY, CYAN, "#ffffff", 40);
    else this.burst(W - TABLE_X, CY, DANGER, "#ffffff", 40);
    this.burst(this.puck.x, this.puck.y, GOLD, "#ffffff", 30);
    this.shake(8);
    this.playSound("goal");
    this.reportStats();

    const newP = this.score.p, newCPU = this.score.cpu;
    if ((newP === MAX_SCORE - 1 || newCPU === MAX_SCORE - 1) && !this.sloMo) {
      this.sloMo = true;
      this.sloMoIntro = 80;
      this.sloMoLabelTimer = 80 + 90;
      this.playSound("slomo_in");
    }

    setTimeout(() => {
      if (this.score.p >= MAX_SCORE || this.score.cpu >= MAX_SCORE) {
        this.state = "over";
        const playerWon = this.score.p >= MAX_SCORE;
        this.showSadFace = !playerWon;
        this.burst(CX, CY, GOLD, "#ffffff", 80);
        if (playerWon) {
          this.playSound("victory");
          this.spawnConfetti();
          setTimeout(() => this.spawnConfetti(), 400);
          setTimeout(() => this.spawnConfetti(), 800);
          setTimeout(() => this.spawnConfetti(), 1400);
          this.confettiInterval = setInterval(() => this.spawnConfetti(), 1400);
        }
        this.callbacks.onGameOver({
          winner: playerWon ? "p" : "cpu",
          final: `${this.score.p} – ${this.score.cpu}`,
        });
      } else {
        this.resetRound(who === "p" ? "cpu" : "p");
        this.state = "play";
      }
    }, 1500);
  }

  // ── CPU AI ──
  private updateCPU(ts = 1) {
    const halfW = W / 2;
    const homeX = W - TABLE_X - 110;
    const minX = halfW + 10, maxX = W - TABLE_X - this.cpu.r - 2;
    const minY = TABLE_Y + this.cpu.r + 2, maxY = TABLE_Y + TABLE_H - this.cpu.r - 2;

    if (Math.random() < CPU_MISTAKE_CHANCE && this.cpu.mistakeTimer === 0 && this.puck.vx > 0) {
      this.cpu.mistakeTimer = CPU_MISTAKE_DUR;
      this.cpu.errorY = (Math.random() - 0.5) * CPU_ERROR_Y * 2;
    }
    if (this.cpu.mistakeTimer > 0) this.cpu.mistakeTimer--;
    if (this.cpu.hitCool > 0) this.cpu.hitCool--;

    const err = this.cpu.mistakeTimer > 0 ? this.cpu.errorY : 0;
    const puckOnMySide = this.puck.x > halfW;
    const puckHeadingToMe = this.puck.vx > 0;

    const nearTopWall = this.cpu.y < minY + 20;
    const nearBottomWall = this.cpu.y > maxY - 20;
    const nearSideWall = this.cpu.x > maxX - 20;
    const cornered = (nearTopWall || nearBottomWall) && nearSideWall;
    const farFromHome = Math.hypot(this.cpu.x - homeX, this.cpu.y - CY) > 150;

    let tx: number, ty: number;
    if (cornered || (farFromHome && !puckHeadingToMe)) {
      tx = homeX; ty = CY;
    } else if (puckOnMySide && puckHeadingToMe) {
      const frames = Math.max(1, Math.min((this.cpu.x - this.puck.x) / Math.max(0.5, this.puck.vx), 60));
      tx = clamp(this.puck.x + this.puck.vx * frames * CPU_REACT, minX, maxX);
      ty = clamp(this.puck.y + this.puck.vy * frames * CPU_REACT + err, minY, maxY);
    } else if (puckOnMySide) {
      tx = clamp(this.puck.x - 8, minX, maxX - 30);
      ty = clamp(this.puck.y + err, minY, maxY);
    } else {
      tx = homeX;
      ty = clamp(this.puck.y * 0.5 + CY * 0.5 + err * 0.3, minY, maxY);
    }

    const prevX = this.cpu.x, prevY = this.cpu.y;
    const dx = tx - this.cpu.x, dy = ty - this.cpu.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.1) {
      const step = Math.min(dist, CPU_SPEED * ts);
      this.cpu.x += (dx / dist) * step;
      this.cpu.y += (dy / dist) * step;
    }
    this.cpu.x = clamp(this.cpu.x, minX, maxX);
    this.cpu.y = clamp(this.cpu.y, minY, maxY);
    this.cpu.vx = this.cpu.x - prevX;
    this.cpu.vy = this.cpu.y - prevY;
  }

  // ── Physics ──
  private updatePuck() {
    if (this.state !== "play") return;
    const G = this.puck;

    const spd = Math.hypot(G.vx, G.vy);
    this.trail.push({ x: G.x, y: G.y, spd });
    if (this.trail.length > 18) this.trail.shift();

    if (spd < 0.8) {
      G.vx += (Math.random() - 0.5) * 0.18;
      G.vy += (Math.random() - 0.5) * 0.18;
    } else if (spd < 2.5) {
      G.vx += (Math.random() - 0.5) * 0.06;
      G.vy += (Math.random() - 0.5) * 0.06;
    }

    G.x += G.vx; G.y += G.vy;
    G.vx *= FRICTION; G.vy *= FRICTION;

    const tx = TABLE_X, ty = TABLE_Y, tw = TABLE_W, th = TABLE_H;

    if (G.y - G.r < ty) {
      G.y = ty + G.r;
      G.vy = Math.abs(G.vy) * WALL_BOUNCE;
      this.sparkLine(G.x - 20, ty, G.x + 20, ty, CYAN);
      this.playSound("wall");
    }
    if (G.y + G.r > ty + th) {
      G.y = ty + th - G.r;
      G.vy = -Math.abs(G.vy) * WALL_BOUNCE;
      this.sparkLine(G.x - 20, ty + th, G.x + 20, ty + th, CYAN);
      this.playSound("wall");
    }
    if (G.x - G.r < tx) {
      if (G.y > GOAL_Y1 && G.y < GOAL_Y2) { this.goalScored("cpu"); return; }
      G.x = tx + G.r;
      G.vx = Math.abs(G.vx) * WALL_BOUNCE;
      this.sparkLine(tx, G.y - 20, tx, G.y + 20, DANGER);
      this.playSound("wall");
    }
    if (G.x + G.r > tx + tw) {
      if (G.y > GOAL_Y1 && G.y < GOAL_Y2) { this.goalScored("p"); return; }
      G.x = tx + tw - G.r;
      G.vx = -Math.abs(G.vx) * WALL_BOUNCE;
      this.sparkLine(tx + tw, G.y - 20, tx + tw, G.y + 20, DANGER);
      this.playSound("wall");
    }

    this.circleMalletCollide(this.puck, this.player, true);
    this.circleMalletCollide(this.puck, this.cpu, false);
  }

  private circleMalletCollide(pk: { x: number; y: number; vx: number; vy: number; r: number }, mallet: Mallet | Cpu, isPlayer: boolean) {
    const dx = pk.x - mallet.x, dy = pk.y - mallet.y;
    const dist = Math.hypot(dx, dy);
    const minDist = pk.r + mallet.r;
    if (dist >= minDist || dist < 0.01) return;

    if (!isPlayer && this.cpu.hitCool > 0) {
      const nx2 = dx / dist, ny2 = dy / dist;
      pk.x += nx2 * (minDist - dist);
      pk.y += ny2 * (minDist - dist);
      return;
    }

    const nx = dx / dist, ny = dy / dist;
    pk.x += nx * (minDist - dist);
    pk.y += ny * (minDist - dist);

    const mvx = isPlayer ? (mallet as Mallet).pvx * 1.8 : (mallet as Cpu).vx;
    const mvy = isPlayer ? (mallet as Mallet).pvy * 1.8 : (mallet as Cpu).vy;

    const relVX = pk.vx - mvx, relVY = pk.vy - mvy;
    const dot = relVX * nx + relVY * ny;
    if (dot >= 0) return;

    const restitution = isPlayer ? 1.3 : 1.1;
    const impulse = -(1 + restitution) * dot;
    pk.vx += impulse * nx;
    pk.vy += impulse * ny;

    const spd = Math.hypot(pk.vx, pk.vy);
    const cap = (isPlayer ? 20 : 16) * this.puckSpeedMult;
    if (spd > cap) {
      pk.vx = (pk.vx / spd) * cap;
      pk.vy = (pk.vy / spd) * cap;
    }

    if (!isPlayer) this.cpu.hitCool = 20;

    const who = isPlayer ? "p" : "cpu";
    this.stats.rallyHits++;
    const mphSpd = Math.round(spd * 4);
    if (mphSpd > this.stats[who].topSpeed) this.stats[who].topSpeed = mphSpd;
    if (spd > 14) this.stats[who].powerHits++;
    this.reportStats();
    this.playSound("hit", spd);

    if (spd > 3) {
      const col = isPlayer ? CYAN : DANGER;
      this.burst(pk.x, pk.y, col, "#ffffff", Math.floor(spd * 1.5));
      if (spd > 19) this.shake(Math.min((spd - 19) * 0.4, 3));
    }
  }

  private updatePlayer(ts = 1) {
    const dx = this.rawMouseX - this.prevRawX, dy = this.rawMouseY - this.prevRawY;
    this.mouseVX = this.mouseVX * 0.4 + dx * 0.6;
    this.mouseVY = this.mouseVY * 0.4 + dy * 0.6;
    this.prevRawX = this.rawMouseX;
    this.prevRawY = this.rawMouseY;

    if (ts === 1) {
      this.player.x = this.rawMouseX;
      this.player.y = this.rawMouseY;
    } else {
      this.player.x += (this.rawMouseX - this.player.x) * ts * 3;
      this.player.y += (this.rawMouseY - this.player.y) * ts * 3;
      this.player.x = clamp(this.player.x, TABLE_X + MALLET_R + 2, CX - 10);
      this.player.y = clamp(this.player.y, TABLE_Y + MALLET_R + 2, TABLE_Y + TABLE_H - MALLET_R - 2);
    }

    this.player.pvx = this.mouseVX * ts;
    this.player.pvy = this.mouseVY * ts;
  }

  private updatePuckScaled(ts: number) {
    if (ts !== 1) { this.puck.vx *= ts; this.puck.vy *= ts; }
    this.updatePuck();
    if (ts !== 1 && this.state === "play") { this.puck.vx /= ts; this.puck.vy /= ts; }
  }

  private updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.96; p.life -= 0.028;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ── Rendering ──
  private grd(x: number, y: number, r0: number, r1: number, c0: string, c1: string) {
    const g = this.ctx.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  }

  private lgrad(x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    return g;
  }

  private lighten(hex: string, amt: number) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${clamp((r + amt * 255) | 0, 0, 255)},${clamp((g + amt * 255) | 0, 0, 255)},${clamp((b + amt * 255) | 0, 0, 255)})`;
  }

  private darken(hex: string, amt: number) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.max(0, (r - amt * 255) | 0)},${Math.max(0, (g - amt * 255) | 0)},${Math.max(0, (b - amt * 255) | 0)})`;
  }

  private drawTable() {
    const G = this.ctx;
    const tx = TABLE_X, ty = TABLE_Y, tw = TABLE_W, th = TABLE_H;

    G.save();
    G.shadowColor = "rgba(0,180,255,0.2)";
    G.shadowBlur = 28;
    G.strokeStyle = "rgba(0,180,255,0.25)";
    G.lineWidth = 3;
    G.beginPath();
    G.roundRect(tx - 4, ty - 4, tw + 8, th + 8, 14);
    G.stroke();
    G.restore();

    G.fillStyle = this.lgrad(tx, ty, tx, ty + th, [[0, "#0a1a2e"], [0.5, "#071422"], [1, "#0a1a2e"]]);
    G.beginPath();
    G.roundRect(tx, ty, tw, th, 10);
    G.fill();

    G.save();
    G.globalAlpha = 0.055;
    G.fillStyle = "#4af";
    for (let gx = tx + 18; gx < tx + tw - 10; gx += 18)
      for (let gy = ty + 18; gy < ty + th - 10; gy += 18) {
        G.beginPath();
        G.arc(gx, gy, 1.8, 0, Math.PI * 2);
        G.fill();
      }
    G.restore();

    G.save();
    G.strokeStyle = "rgba(0,212,255,0.16)";
    G.lineWidth = 2;
    G.setLineDash([6, 6]);
    G.beginPath();
    G.arc(CX, CY, 60, 0, Math.PI * 2);
    G.stroke();
    G.setLineDash([]);
    G.restore();

    G.save();
    G.strokeStyle = "rgba(0,212,255,0.12)";
    G.lineWidth = 2;
    G.setLineDash([8, 8]);
    G.beginPath();
    G.moveTo(CX, ty + 2);
    G.lineTo(CX, ty + th - 2);
    G.stroke();
    G.setLineDash([]);
    G.restore();

    G.save();
    G.shadowColor = "rgba(0,212,255,0.5)";
    G.shadowBlur = 8;
    G.fillStyle = "rgba(0,212,255,0.4)";
    G.beginPath();
    G.arc(CX, CY, 5, 0, Math.PI * 2);
    G.fill();
    G.restore();

    const rt = this.lgrad(0, ty, 0, ty + 12, [[0, "#1a4a6e"], [0.6, "#0e2a40"], [1, "#0a1a2e"]]);
    G.fillStyle = rt;
    G.fillRect(tx, ty, tw, 8);
    const rb = this.lgrad(0, ty + th - 8, 0, ty + th, [[0, "#0a1a2e"], [0.4, "#0e2a40"], [1, "#1a4a6e"]]);
    G.fillStyle = rb;
    G.fillRect(tx, ty + th - 8, tw, 8);

    G.save();
    G.shadowColor = "#00d4ff";
    G.shadowBlur = 10;
    G.strokeStyle = "rgba(0,212,255,0.7)";
    G.lineWidth = 2;
    G.beginPath();
    G.moveTo(tx + 2, ty + 2);
    G.lineTo(tx + tw - 2, ty + 2);
    G.stroke();
    G.beginPath();
    G.moveTo(tx + 2, ty + th - 2);
    G.lineTo(tx + tw - 2, ty + th - 2);
    G.stroke();
    G.restore();

    G.save();
    G.shadowColor = "#00d4ff";
    G.shadowBlur = 14;
    G.strokeStyle = "rgba(0,212,255,0.7)";
    G.lineWidth = 2.5;
    G.beginPath(); G.moveTo(tx, GOAL_Y1); G.lineTo(tx - GOAL_DEPTH, GOAL_Y1); G.stroke();
    G.beginPath(); G.moveTo(tx, GOAL_Y2); G.lineTo(tx - GOAL_DEPTH, GOAL_Y2); G.stroke();
    G.strokeStyle = "rgba(0,212,255,0.3)";
    G.lineWidth = 1.5;
    G.beginPath(); G.moveTo(tx - GOAL_DEPTH, GOAL_Y1); G.lineTo(tx - GOAL_DEPTH, GOAL_Y2); G.stroke();
    G.restore();

    G.save();
    G.shadowColor = "#ff2d55";
    G.shadowBlur = 14;
    G.strokeStyle = "rgba(255,45,85,0.7)";
    G.lineWidth = 2.5;
    G.beginPath(); G.moveTo(tx + tw, GOAL_Y1); G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y1); G.stroke();
    G.beginPath(); G.moveTo(tx + tw, GOAL_Y2); G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y2); G.stroke();
    G.strokeStyle = "rgba(255,45,85,0.3)";
    G.lineWidth = 1.5;
    G.beginPath(); G.moveTo(tx + tw + GOAL_DEPTH, GOAL_Y1); G.lineTo(tx + tw + GOAL_DEPTH, GOAL_Y2); G.stroke();
    G.restore();

    [GOAL_Y1, GOAL_Y2].forEach((gy) => {
      G.save();
      G.shadowColor = "#00d4ff";
      G.shadowBlur = 12;
      G.fillStyle = "#00d4ff";
      G.beginPath(); G.arc(tx, gy, 5, 0, Math.PI * 2); G.fill();
      G.restore();
      G.save();
      G.shadowColor = "#ff2d55";
      G.shadowBlur = 12;
      G.fillStyle = "#ff2d55";
      G.beginPath(); G.arc(tx + tw, gy, 5, 0, Math.PI * 2); G.fill();
      G.restore();
    });
  }

  private drawPuck() {
    const G = this.ctx;
    this.trail.forEach((t, i) => {
      const prog = i / this.trail.length;
      const r = prog * 9 * Math.min(t.spd / 6, 1);
      if (r < 0.5) return;
      G.save();
      G.globalAlpha = prog * 0.55 * Math.min(t.spd / 5, 1);
      G.fillStyle = this.grd(t.x, t.y, 0, r * 2, "rgba(0,212,255,0.9)", "transparent");
      G.beginPath();
      G.arc(t.x, t.y, r * 2.2, 0, Math.PI * 2);
      G.fill();
      G.restore();
    });

    const bx = this.puck.x, by = this.puck.y, br = this.puck.r;
    const spd = Math.hypot(this.puck.vx, this.puck.vy);

    G.save();
    G.shadowColor = "#00d4ff";
    G.shadowBlur = 24 + spd * 1.5;
    G.fillStyle = this.grd(bx, by, 0, br + 8, "rgba(0,212,255,0.18)", "transparent");
    G.beginPath();
    G.arc(bx, by, br + 14, 0, Math.PI * 2);
    G.fill();
    G.restore();

    G.fillStyle = this.grd(bx - br * 0.3, by - br * 0.3, br * 0.1, br, "#ffffff", "#cccccc");
    G.beginPath();
    G.arc(bx, by, br, 0, Math.PI * 2);
    G.fill();

    G.save();
    G.shadowColor = "#00d4ff";
    G.shadowBlur = 8;
    G.strokeStyle = "#00d4ff";
    G.lineWidth = 2.5;
    G.beginPath();
    G.arc(bx, by, br - 1, 0, Math.PI * 2);
    G.stroke();
    G.restore();

    G.strokeStyle = "rgba(0,212,255,0.32)";
    G.lineWidth = 1;
    G.beginPath();
    G.arc(bx, by, br * 0.55, 0, Math.PI * 2);
    G.stroke();

    G.fillStyle = "rgba(255,255,255,0.17)";
    G.beginPath();
    G.ellipse(bx - br * 0.28, by - br * 0.3, br * 0.38, br * 0.22, -0.4, 0, Math.PI * 2);
    G.fill();
  }

  private drawMallet(m: { x: number; y: number; r: number }, col: string, glowCol: string) {
    const G = this.ctx;
    const mx = m.x, my = m.y, mr = m.r;

    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 32;
    const halo = G.createRadialGradient(mx, my, mr * 0.6, mx, my, mr + 18);
    halo.addColorStop(0, "transparent");
    halo.addColorStop(0.6, `${glowCol}22`);
    halo.addColorStop(1, "transparent");
    G.fillStyle = halo;
    G.beginPath();
    G.arc(mx, my, mr + 18, 0, Math.PI * 2);
    G.fill();
    G.restore();

    G.save();
    G.globalAlpha = 0.45;
    G.fillStyle = "rgba(0,0,0,0.7)";
    G.beginPath();
    G.ellipse(mx + 3, my + 4, mr, mr * 0.85, 0, 0, Math.PI * 2);
    G.fill();
    G.restore();

    const skirtG = G.createRadialGradient(mx - mr * 0.2, my - mr * 0.2, mr * 0.1, mx, my, mr);
    skirtG.addColorStop(0, this.lighten(col, 0.12));
    skirtG.addColorStop(0.65, col);
    skirtG.addColorStop(1, this.darken(col, 0.45));
    G.fillStyle = skirtG;
    G.beginPath();
    G.arc(mx, my, mr, 0, Math.PI * 2);
    G.fill();

    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 12;
    G.strokeStyle = glowCol;
    G.lineWidth = 2.5;
    G.beginPath();
    G.arc(mx, my, mr - 1.5, 0, Math.PI * 2);
    G.stroke();
    G.restore();

    const grooveR = mr * 0.72;
    G.strokeStyle = "rgba(0,0,0,0.55)";
    G.lineWidth = 3;
    G.beginPath();
    G.arc(mx, my, grooveR, 0, Math.PI * 2);
    G.stroke();
    G.strokeStyle = "rgba(255,255,255,0.08)";
    G.lineWidth = 1;
    G.beginPath();
    G.arc(mx, my, grooveR + 1.5, 0, Math.PI * 2);
    G.stroke();

    const domeR = mr * 0.62;
    const domeG = G.createRadialGradient(mx - domeR * 0.3, my - domeR * 0.35, 0, mx, my, domeR);
    domeG.addColorStop(0, this.lighten(col, 0.35));
    domeG.addColorStop(0.5, this.lighten(col, 0.1));
    domeG.addColorStop(1, this.darken(col, 0.2));
    G.fillStyle = domeG;
    G.beginPath();
    G.arc(mx, my, domeR, 0, Math.PI * 2);
    G.fill();

    G.save();
    G.shadowColor = glowCol;
    G.shadowBlur = 14;
    G.fillStyle = glowCol;
    G.beginPath();
    G.arc(mx, my, 4.5, 0, Math.PI * 2);
    G.fill();
    G.restore();

    G.fillStyle = "rgba(255,255,255,0.28)";
    G.beginPath();
    G.ellipse(mx - domeR * 0.3, my - domeR * 0.32, domeR * 0.32, domeR * 0.18, -0.5, 0, Math.PI * 2);
    G.fill();

    G.fillStyle = "rgba(255,255,255,0.12)";
    G.beginPath();
    G.ellipse(mx - domeR * 0.15, my - domeR * 0.5, domeR * 0.14, domeR * 0.08, -0.3, 0, Math.PI * 2);
    G.fill();
  }

  private drawParticles() {
    const G = this.ctx;
    this.particles.forEach((p) => {
      G.save();
      G.globalAlpha = Math.pow(p.life, 1.4) * 0.9;
      if (p.glow) { G.shadowColor = p.col; G.shadowBlur = 10; }
      G.fillStyle = p.col;
      G.beginPath();
      G.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      G.fill();
      G.restore();
    });
  }

  private drawConfetti() {
    const G = this.ctx;
    this.confetti.forEach((c) => {
      G.save();
      G.globalAlpha = c.life;
      G.translate(c.x, c.y);
      G.rotate(c.rot);
      G.fillStyle = c.col;
      G.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      G.restore();
    });
  }

  private drawSadFace() {
    const G = this.ctx;
    const cx = W / 2, cy = H / 2 - 30, r = 52;
    const pulse = 0.85 + Math.sin(this.tick * 0.05) * 0.15;
    G.save();
    G.globalAlpha = 0.82 * pulse;
    G.fillStyle = "#1a0a0a";
    G.beginPath(); G.arc(cx, cy, r, 0, Math.PI * 2); G.fill();
    G.strokeStyle = DANGER;
    G.lineWidth = 3;
    G.shadowColor = DANGER;
    G.shadowBlur = 18;
    G.beginPath(); G.arc(cx, cy, r, 0, Math.PI * 2); G.stroke();
    G.shadowBlur = 0;
    G.strokeStyle = DANGER;
    G.lineWidth = 3.5;
    G.lineCap = "round";
    ([[-18, -12], [18, -12]] as const).forEach(([ex, ey]) => {
      G.beginPath(); G.moveTo(cx + ex - 7, cy + ey - 7); G.lineTo(cx + ex + 7, cy + ey + 7); G.stroke();
      G.beginPath(); G.moveTo(cx + ex + 7, cy + ey - 7); G.lineTo(cx + ex - 7, cy + ey + 7); G.stroke();
    });
    G.strokeStyle = DANGER;
    G.lineWidth = 3.5;
    G.beginPath();
    G.arc(cx, cy + 28, 20, Math.PI * 0.15, Math.PI * 0.85, false);
    G.stroke();
    G.restore();
  }

  private drawGoalFlash() {
    if (this.goalFlash <= 0 || this.state !== "goal") return;
    const G = this.ctx;
    const prog = this.goalFlash / 160, isP = this.goalWho === "p";
    G.save();
    G.globalAlpha = Math.min(prog * 3, 0.16);
    G.fillStyle = isP ? CYAN : DANGER;
    G.fillRect(0, 0, W, H);
    G.restore();

    this.goalMsgScale = Math.min(this.goalMsgScale + 0.12, 1);
    const ease = 1 - Math.pow(1 - this.goalMsgScale, 3);
    G.save();
    G.globalAlpha = Math.min(1, prog * 3) * Math.min(1, this.goalFlash / 40);
    G.translate(W / 2, H / 2);
    G.scale(ease, ease);
    G.textAlign = "center";
    G.font = '900 64px "Orbitron"';
    G.fillStyle = isP ? CYAN : DANGER;
    G.shadowColor = isP ? CYAN : DANGER;
    G.shadowBlur = 40;
    G.fillText("GOAL!", 0, -10);
    G.shadowBlur = 0;
    G.font = '500 13px "Rajdhani"';
    G.fillStyle = isP ? "rgba(0,229,255,0.75)" : "rgba(255,77,109,0.75)";
    G.fillText(isP ? "YOU SCORE" : "CPU SCORES", 0, 22);
    G.restore();
    this.goalFlash--;
  }

  private drawSpeedUpMsg() {
    if (this.speedUpTimer <= 0) return;
    const G = this.ctx;
    const t = this.speedUpTimer / 130;
    const scale = t > 0.85 ? 0.5 + (1 - (t - 0.85) / 0.15) * 0.5 : 1;
    const alpha = t < 0.2 ? t / 0.2 : 1;
    G.save();
    G.globalAlpha = alpha;
    G.translate(W / 2, H / 2 - 60);
    G.scale(scale, scale);
    G.textAlign = "center";
    G.font = '900 34px "Orbitron"';
    G.fillStyle = "#000";
    G.fillText(this.speedUpMsg, 2, 2);
    const grd = G.createLinearGradient(-100, -30, 100, 10);
    grd.addColorStop(0, GOLD);
    grd.addColorStop(1, "#ff6820");
    G.fillStyle = grd;
    G.shadowColor = GOLD;
    G.shadowBlur = 24;
    G.fillText(this.speedUpMsg, 0, 0);
    G.restore();
    this.speedUpTimer--;
  }

  private loop = () => {
    if (this.disposed) return;
    const G = this.ctx;
    this.tick++;
    G.clearRect(0, 0, W, H);
    G.fillStyle = "#04060a";
    G.fillRect(0, 0, W, H);

    if (this.sloMo) this.sloMoAlpha = Math.min(this.sloMoAlpha + 0.055, 1);
    else this.sloMoAlpha = Math.max(this.sloMoAlpha - 0.07, 0);
    if (this.sloMoIntro > 0) this.sloMoIntro--;
    if (this.sloMoLabelTimer > 0) this.sloMoLabelTimer--;

    const timeScale = this.sloMo ? 0.55 : 1;

    if (this.shakeAmt > 0.3) {
      this.shakeX = (Math.random() - 0.5) * this.shakeAmt * 2;
      this.shakeY = (Math.random() - 0.5) * this.shakeAmt * 2;
      this.shakeAmt *= 0.72;
    } else {
      this.shakeX = 0; this.shakeY = 0; this.shakeAmt = 0;
    }

    G.save();
    G.translate(this.shakeX, this.shakeY);

    this.drawTable();

    if (this.state === "play" || this.state === "goal") {
      this.updatePlayer(timeScale);
      this.updateCPU(timeScale);
      this.updatePuckScaled(timeScale);
      this.updateParticles();
    }
    this.updateConfetti();

    this.drawParticles();
    this.drawPuck();
    this.drawMallet(this.cpu, "#2a0a0a", DANGER);
    this.drawMallet(this.player, "#0a1a2a", CYAN);
    this.drawGoalFlash();
    this.drawSpeedUpMsg();
    this.drawConfetti();
    if (this.showSadFace) this.drawSadFace();

    if (this.sloMoAlpha > 0) {
      const vig = G.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.75);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, `rgba(0,0,0,${0.65 * this.sloMoAlpha})`);
      G.fillStyle = vig;
      G.fillRect(0, 0, W, H);

      const barH = 32 * this.sloMoAlpha;
      G.fillStyle = `rgba(0,0,0,${0.88 * this.sloMoAlpha})`;
      G.fillRect(0, 0, W, barH);
      G.fillRect(0, H - barH, W, barH);

      G.save();
      G.globalAlpha = 0.15 * this.sloMoAlpha;
      G.fillStyle = "#ff0040";
      G.fillRect(0, 0, 5, H);
      G.fillRect(W - 5, 0, 5, H);
      G.fillStyle = "#0080ff";
      G.fillRect(5, 0, 5, H);
      G.fillRect(W - 10, 0, 5, H);
      G.restore();

      if (this.sloMoLabelTimer > 0) {
        const fadeIn = Math.min(this.sloMoLabelTimer / 20, 1);
        const fadeOut = this.sloMoLabelTimer < 30 ? this.sloMoLabelTimer / 30 : 1;
        const alpha = fadeIn * fadeOut * this.sloMoAlpha;
        const pulse = 0.88 + Math.sin(this.tick * 0.12) * 0.12;

        G.save();
        G.globalAlpha = alpha * pulse;
        G.textAlign = "center";
        G.font = '900 16px "Orbitron"';
        G.fillStyle = "rgba(0,0,0,0.5)";
        G.fillText("⚡  GAME POINT  ⚡", W / 2 + 1, barH * 0.72 + 1);
        G.fillStyle = GOLD;
        G.shadowColor = GOLD;
        G.shadowBlur = 14;
        G.fillText("⚡  GAME POINT  ⚡", W / 2, barH * 0.72);
        G.shadowBlur = 0;
        G.restore();
      }
    }

    G.restore();
    this.raf = requestAnimationFrame(this.loop);
  };
}
