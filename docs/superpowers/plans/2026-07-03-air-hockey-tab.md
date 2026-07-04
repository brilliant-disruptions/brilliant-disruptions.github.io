# Air Hockey Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new top-level "Air Hockey" tab to Jarvis (sibling of Neural, not nested under it) that ports the CodePen `michaeljwilt/MYJORbg` — a neon Canvas 2D air hockey game with CPU opponent, physics, particles, confetti, slo-mo game-point drama, and stats — into a native React page.

**Architecture:** A framework-agnostic `AirHockeyGame` class in `lib/air-hockey/game.ts` (same shape as `lib/neural/scene.ts`'s `NeuralScene`) owns canvas rendering, physics, CPU AI, particles, and Web Audio SFX, and reports state to React only via constructor-supplied callbacks. A client page at `app/(app)/air-hockey/page.tsx` owns score/stats/mute/game-over React state, renders the stat panels and game-over overlay with Tailwind + the app's existing CSS vars, and drives the class's lifecycle.

**Tech Stack:** Next.js (App Router) client component, TypeScript, Canvas 2D API, Web Audio API, `next/font/google`, Tailwind CSS (existing app conventions).

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-03-air-hockey-tab-design.md` — read it before starting if anything below is ambiguous.
- Normal tab page — TopBar and tab nav stay visible (no full-screen takeover like Neural).
- Nav tab label is exactly "Air Hockey", route is `/air-hockey`.
- DOM chrome (stat panels, mute pill, game-over overlay) uses the app's CSS vars: `var(--cyan)` for the player side, `var(--danger)` for the CPU side, `var(--gold)` for accents — not the pen's own `--blue`/`--red`/`--gold` hex values.
- Canvas-internal rendering keeps hex color constants (canvas APIs can't read CSS vars) but those constants must be seeded from the same hex values backing `--cyan` (`#00e5ff`), `--danger` (`#ff4d6d`), `--gold` (`#ffb347`) — confirmed in `jarvis-app/app/globals.css`.
- Fonts `Orbitron` (400/700/900) and `Rajdhani` (300/400/500/600/700) are added via `next/font/google`, scoped to the air-hockey page only (not the root layout), following the exact pattern in `jarvis-app/app/layout.tsx`.
- Font Awesome is NOT added — confirmed unused in the pen's actual markup/CSS/JS.
- No Supabase persistence of scores/stats (local in-memory game state only).
- No unit tests for canvas rendering/physics — matches the existing convention in `lib/neural/` (only pure-logic helpers like `greetings.ts` get `.test.ts` files; this game's logic isn't split into similarly pure standalone helpers). Verification is manual, via the dev server, at the end of this plan.
- All new source files live under `jarvis-app/` (the Next.js app root), e.g. `jarvis-app/lib/air-hockey/game.ts`, `jarvis-app/app/(app)/air-hockey/page.tsx`.

---

### Task 1: `AirHockeyGame` class scaffold — types, constants, lifecycle

**Files:**
- Create: `jarvis-app/lib/air-hockey/game.ts`

**Interfaces:**
- Produces: `export type SideStats = { streak: number; topSpeed: number; powerHits: number }`, `export type GameOverResult = { winner: "p" | "cpu"; final: string } | null`, `export type AirHockeyCallbacks = { onStats: (stats: { p: SideStats; cpu: SideStats }) => void; onScore: (score: { p: number; cpu: number }) => void; onGameOver: (result: GameOverResult) => void; onMuteChange: (muted: boolean) => void }`, `export class AirHockeyGame { constructor(canvas: HTMLCanvasElement, callbacks: AirHockeyCallbacks); init(): void; dispose(): void; startGame(): void; toggleMute(): void }`.

- [ ] **Step 1: Create the file with header comment, imports, constants, and types**

```ts
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
    this.loop();
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  startGame() {
    this.state = "play";
  }

  toggleMute() {
    this.callbacks.onMuteChange(true);
  }

  private loop = () => {
    if (this.disposed) return;
    this.tick++;
    const G = this.ctx;
    G.clearRect(0, 0, W, H);
    G.fillStyle = "#04060a";
    G.fillRect(0, 0, W, H);
    this.raf = requestAnimationFrame(this.loop);
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no errors referencing `lib/air-hockey/game.ts`.

- [ ] **Step 3: Commit**

```bash
cd jarvis-app && git add lib/air-hockey/game.ts && git commit -m "$(cat <<'EOF'
Scaffold AirHockeyGame class

Types, constants, and lifecycle (constructor/init/dispose) for the
ported air hockey game, following the NeuralScene pattern.
EOF
)"
```

---

### Task 2: Web Audio SFX engine + mute

**Files:**
- Modify: `jarvis-app/lib/air-hockey/game.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `private playSound(type: "hit" | "wall" | "goal" | "victory" | "speedup" | "slomo_in", speed?: number): void`, `private muted: boolean`, `toggleMute()` now flips `this.muted` and calls `this.callbacks.onMuteChange(this.muted)`.

- [ ] **Step 1: Add the audio engine fields and methods to the class**

Add these private fields near the top of the class body (after `private tick = 0;`):

```ts
  private audioCtx: AudioContext | null = null;
  private muted = true;
```

Add these methods to the class (private instance methods, so `this` inside arrow-bound helpers refers to the instance):

```ts
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
```

Replace the placeholder `toggleMute()` method from Task 1 with:

```ts
  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted) this.getAudio().resume();
    this.callbacks.onMuteChange(this.muted);
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no errors referencing `lib/air-hockey/game.ts`.

- [ ] **Step 3: Commit**

```bash
cd jarvis-app && git add lib/air-hockey/game.ts && git commit -m "$(cat <<'EOF'
Add Web Audio SFX engine to AirHockeyGame

Procedurally synthesized hit/wall/goal/victory/speedup/slomo sounds,
ported verbatim from the pen. toggleMute() now reports state via
onMuteChange instead of writing to the DOM.
EOF
)"
```

---

### Task 3: Game state, physics, and CPU AI

**Files:**
- Modify: `jarvis-app/lib/air-hockey/game.ts`

**Interfaces:**
- Consumes: `this.playSound(...)` from Task 2, `AirHockeyCallbacks` from Task 1.
- Produces: `startGame()` (replaces Task 1's placeholder) resets and starts a match; private methods `resetRound`, `goalScored`, `shake`, `updateStatDOM` (renamed `reportStats` — calls callbacks instead of touching the DOM), `updateCPU`, `updatePuck`, `circleMalletCollide`, `updatePlayer`, `updatePuckScaled`; fields `score`, `stats`, `puck`, `player`, `cpu`, `sloMo*`, `confetti`, `particles`, `trail`, `puckSpeedMult`, `goalFlash`, `goalWho`, `speedUpMsg`, `speedUpTimer`, `showSadFace`.
- Note: the original pen reads live mouse position from module-level `rawMouseX`/`rawMouseY` written by DOM event listeners; those listeners are added in Task 5, but the fields must exist now since `updatePlayer` reads them.

- [ ] **Step 1: Add state fields**

Add these private fields to the class (after the audio fields from Task 2):

```ts
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
```

- [ ] **Step 2: Add particle/confetti helpers**

```ts
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
```

- [ ] **Step 3: Add game flow methods, replacing Task 1's placeholder `startGame()`**

```ts
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
```

- [ ] **Step 4: Add CPU AI, puck physics, collision, and player-input-to-mallet methods**

```ts
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
```

- [ ] **Step 5: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: errors about `drawTable`/`drawPuck`/etc. not existing yet are OK if the loop references them — for this step, do NOT call any draw methods from `loop()` yet (Task 4 adds them). The physics/state methods above must themselves compile with no errors. If `tsc` complains about unused private methods, that's expected at this stage (not an error, just potentially a lint warning) — confirm there are no *type* errors.

- [ ] **Step 6: Commit**

```bash
cd jarvis-app && git add lib/air-hockey/game.ts && git commit -m "$(cat <<'EOF'
Add game state, physics, and CPU AI to AirHockeyGame

Ports puck/mallet collision, wall/goal detection, CPU opponent AI,
speed escalation, and slo-mo game-point triggering. Stat/score
reporting goes through callbacks instead of direct DOM writes.
EOF
)"
```

---

### Task 4: Rendering — table, puck, mallets, particles, overlays, main loop

**Files:**
- Modify: `jarvis-app/lib/air-hockey/game.ts`

**Interfaces:**
- Consumes: all state/physics fields and methods from Task 3.
- Produces: private draw methods (`drawTable`, `drawPuck`, `drawMallet`, `drawParticles`, `drawConfetti`, `drawGoalFlash`, `drawSpeedUpMsg`, `drawSadFace`) and color helpers (`grd`, `lgrad`, `lighten`, `darken`); replaces the `loop` arrow method from Task 1 with the full render+update loop.

- [ ] **Step 1: Add color/gradient helpers**

```ts
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
```

- [ ] **Step 2: Add `drawTable`**

```ts
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
```

- [ ] **Step 3: Add `drawPuck`, `drawMallet`, `drawParticles`, `drawConfetti`**

```ts
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
```

- [ ] **Step 4: Add `drawGoalFlash` and `drawSpeedUpMsg`**

```ts
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
```

- [ ] **Step 5: Replace the `loop` arrow method from Task 1 with the full loop**

```ts
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
```

- [ ] **Step 6: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no type errors in `lib/air-hockey/game.ts`. `roundRect` requires a modern TS DOM lib target — if it errors as missing, check `jarvis-app/tsconfig.json`'s `lib` includes at least `ES2021`+DOM (Next.js default config already does; do not change tsconfig unless this specific error appears).

- [ ] **Step 7: Commit**

```bash
cd jarvis-app && git add lib/air-hockey/game.ts && git commit -m "$(cat <<'EOF'
Add rendering and main loop to AirHockeyGame

Ports table/puck/mallet/particle/confetti drawing, goal-flash and
speed-up banners, and the slo-mo cinematic overlay. Colors are seeded
from the app's --cyan/--danger/--gold values per the design spec.
EOF
)"
```

---

### Task 5: Input handling — mouse, touch, keyboard

**Files:**
- Modify: `jarvis-app/lib/air-hockey/game.ts`

**Interfaces:**
- Consumes: `this.rawMouseX`/`rawMouseY` fields from Task 3, `this.toggleMute()` from Task 2, `this.startGame()` from Task 3.
- Produces: `init()` (replaces Task 1's placeholder) attaches listeners and starts the loop; `dispose()` (extends Task 1's version) removes them.

- [ ] **Step 1: Add a `pointerToCanvas` method and listener fields**

Add this field near the top of the class (with the other lifecycle fields):

```ts
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
```

Add the method:

```ts
  private pointerToCanvas(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const scaleX = W / r.width, scaleY = H / r.height;
    const nx = (clientX - r.left) * scaleX;
    const ny = (clientY - r.top) * scaleY;
    this.rawMouseX = clamp(nx, TABLE_X + MALLET_R + 2, CX - 10);
    this.rawMouseY = clamp(ny, TABLE_Y + MALLET_R + 2, TABLE_Y + TABLE_H - MALLET_R - 2);
  }
```

- [ ] **Step 2: Replace `init()` and `dispose()` from Task 1**

```ts
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
```

- [ ] **Step 3: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no type errors in `lib/air-hockey/game.ts`.

- [ ] **Step 4: Commit**

```bash
cd jarvis-app && git add lib/air-hockey/game.ts && git commit -m "$(cat <<'EOF'
Wire mouse/touch/keyboard input into AirHockeyGame

init() attaches listeners and starts the match; dispose() tears
everything down (listeners, RAF, confetti interval) for clean
React unmount.
EOF
)"
```

---

### Task 6: React page — `app/(app)/air-hockey/page.tsx`

**Files:**
- Create: `jarvis-app/app/(app)/air-hockey/page.tsx`

**Interfaces:**
- Consumes: `AirHockeyGame`, `SideStats`, `GameOverResult`, `AirHockeyCallbacks` from `jarvis-app/lib/air-hockey/game.ts` (Tasks 1-5).
- Produces: default-exported `AirHockeyPage` React component rendered at route `/air-hockey`.

- [ ] **Step 1: Write the page component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AirHockeyGame, type SideStats, type GameOverResult } from "@/lib/air-hockey/game";

const ARENA_W = 760;
const ARENA_H = 520;

export default function AirHockeyPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<AirHockeyGame | null>(null);

  const [score, setScore] = useState({ p: 0, cpu: 0 });
  const [stats, setStats] = useState<{ p: SideStats; cpu: SideStats }>({
    p: { streak: 0, topSpeed: 0, powerHits: 0 },
    cpu: { streak: 0, topSpeed: 0, powerHits: 0 },
  });
  const [muted, setMuted] = useState(true);
  const [gameOver, setGameOver] = useState<GameOverResult>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!canvasRef.current) return;
    const game = new AirHockeyGame(canvasRef.current, {
      onStats: setStats,
      onScore: setScore,
      onGameOver: setGameOver,
      onMuteChange: setMuted,
    });
    gameRef.current = game;
    game.init();
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? ARENA_W;
      setScale(Math.min(1, width / ARENA_W));
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div ref={wrapperRef} className="flex w-full max-w-[1100px] items-center justify-center">
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
          className="flex items-stretch gap-0"
        >
          <StatPanel label="YOU" color="var(--cyan)" score={score.p} stats={stats.p} />

          <div
            className="relative overflow-hidden"
            style={{ width: ARENA_W, height: ARENA_H, borderRadius: 18 }}
          >
            <canvas ref={canvasRef} className="block h-full w-full" />

            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 font-mono text-[10px] tracking-widest text-[var(--muted-hi)]">
              {muted ? "PRESS S FOR SOUND" : "PRESS S TO MUTE"}
            </div>

            {gameOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="text-center">
                  <div className="mb-2 text-6xl">{gameOver.winner === "p" ? "\u{1F604}" : "\u{1F622}"}</div>
                  <div
                    className="font-display text-4xl font-black sm:text-5xl"
                    style={{ color: gameOver.winner === "p" ? "var(--cyan)" : "var(--danger)" }}
                  >
                    {gameOver.winner === "p" ? "YOU WIN" : "CPU WINS"}
                  </div>
                  <div className="mt-1 font-mono text-sm tracking-[0.3em] text-[var(--muted-hi)]">
                    {gameOver.winner === "p" ? "GAME · SET · MATCH" : "BETTER LUCK NEXT TIME"}
                  </div>
                  <div className="my-4 text-2xl font-bold" style={{ color: "var(--gold)" }}>
                    {gameOver.final}
                  </div>
                  <button
                    onClick={() => gameRef.current?.startGame()}
                    className="px-9 py-3 font-mono text-sm font-bold tracking-widest transition"
                    style={{
                      border: "2px solid var(--cyan)",
                      color: "var(--cyan)",
                      clipPath: "polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
                    }}
                  >
                    PLAY AGAIN
                  </button>
                </div>
              </div>
            )}
          </div>

          <StatPanel label="CPU" color="var(--danger)" score={score.cpu} stats={stats.cpu} />
        </div>
      </div>
    </div>
  );
}

function StatPanel({
  label,
  color,
  score,
  stats,
}: {
  label: string;
  color: string;
  score: number;
  stats: SideStats;
}) {
  return (
    <div className="flex w-[130px] shrink-0 flex-col items-center gap-0 border border-[var(--glass-border)] bg-[var(--surface)] px-2.5 pb-3 pt-4">
      <div className="mb-1.5 w-full text-center font-mono text-[10px] font-bold tracking-[4px]" style={{ color }}>
        {label}
      </div>
      <div className="mb-1.5 w-full text-center font-display text-5xl font-black leading-none" style={{ color, textShadow: `0 0 20px ${color}` }}>
        {score}
      </div>
      <div className="my-1.5 h-px w-full bg-white/[0.07]" />
      <StatRow label="STREAK" value={stats.streak} />
      <StatRow label="TOP SPEED" value={stats.topSpeed} />
      <StatRow label="POWER HITS" value={stats.powerHits} />
      <div className="my-1.5 h-px w-full bg-white/[0.07]" />
      <div className="mt-0.5 text-center font-mono text-[9px] tracking-[2px] text-white/20">
        FIRST TO 7 WINS
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-2 flex w-full items-center justify-between">
      <span className="text-[9px] font-medium tracking-[1.5px] text-white/30 uppercase">{label}</span>
      <span className="font-mono text-xs font-bold text-white/75">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no type errors in `app/(app)/air-hockey/page.tsx` or `lib/air-hockey/game.ts`.

- [ ] **Step 3: Commit**

```bash
cd jarvis-app && git add "app/(app)/air-hockey/page.tsx" && git commit -m "$(cat <<'EOF'
Add Air Hockey React page

Renders the game canvas, stat panels, mute indicator, and game-over
overlay, wired to AirHockeyGame via callbacks. Arena scales to fit
its container via ResizeObserver instead of the pen's 100vw trick.
EOF
)"
```

---

### Task 7: Fonts + nav tab entry

**Files:**
- Modify: `jarvis-app/app/(app)/air-hockey/page.tsx`
- Modify: `jarvis-app/components/TopBar.tsx`

**Interfaces:**
- Consumes: `next/font/google` (already a project dependency via `app/layout.tsx`).
- Produces: page-scoped `--font-orbitron`/`--font-rajdhani` CSS vars; new `["Air Hockey", "/air-hockey"]` entry in `TopBar.tsx`'s `TABS`.

- [ ] **Step 1: Add page-scoped fonts to the air-hockey page**

In `jarvis-app/app/(app)/air-hockey/page.tsx`, add the import and font instances at the top of the file (fonts must be module-level `const`, not inside the component, per `next/font` rules):

```tsx
import { Orbitron, Rajdhani } from "next/font/google";

const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["400", "700", "900"] });
const rajdhani = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });
```

Apply the variables by wrapping the existing top-level returned `<div>` with the font classNames. Change:

```tsx
    <div className="flex flex-col items-center gap-4">
```

to:

```tsx
    <div className={`${orbitron.variable} ${rajdhani.variable} flex flex-col items-center gap-4`}>
```

Update the score/label styling to use these fonts instead of the app's default `font-display`/font-mono, so the arcade look matches the pen. In `StatPanel`, change the label className from `font-mono` to an inline style using the Orbitron var, and the score className's `font-display` to the same:

```tsx
      <div
        className="mb-1.5 w-full text-center text-[10px] font-bold tracking-[4px]"
        style={{ color, fontFamily: "var(--font-orbitron)" }}
      >
        {label}
      </div>
      <div
        className="mb-1.5 w-full text-center text-5xl font-black leading-none"
        style={{ color, textShadow: `0 0 20px ${color}`, fontFamily: "var(--font-orbitron)" }}
      >
        {score}
      </div>
```

And in the game-over overlay, change the winner heading's className from `font-display` to an inline `fontFamily: "var(--font-orbitron)"` style alongside its existing `color` style:

```tsx
                  <div
                    className="mb-2 text-4xl font-black sm:text-5xl"
                    style={{ color: gameOver.winner === "p" ? "var(--cyan)" : "var(--danger)", fontFamily: "var(--font-orbitron)" }}
                  >
```

(Note: the literal text above should replace the existing `font-display text-4xl font-black sm:text-5xl` className + `style={{ color: ... }}` block from Task 6 — same element, just swapping the font source.)

- [ ] **Step 2: Add the nav tab**

In `jarvis-app/components/TopBar.tsx`, the `TABS` array currently ends with `["Neural", "/neural"]`. Add the new entry right after it:

```tsx
const TABS = [
  ["Overview", "/overview"],
  ["Engineering", "/engineering"],
  ["FinOps", "/finops"],
  ["Growth", "/growth"],
  ["Customers", "/customers"],
  ["Agents", "/agents"],
  ["Forecast", "/forecast"],
  ["Connections", "/connections"],
  ["Activity", "/activity"],
  ["Rules", "/rules"],
  ["Neural", "/neural"],
  ["Air Hockey", "/air-hockey"],
] as const;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd jarvis-app && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
cd jarvis-app && git add "app/(app)/air-hockey/page.tsx" components/TopBar.tsx && git commit -m "$(cat <<'EOF'
Add Orbitron/Rajdhani fonts and Air Hockey nav tab

Fonts are scoped to the air-hockey page only via next/font/google,
matching the pen's arcade typography without affecting other tabs.
EOF
)"
```

---

### Task 8: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `cd jarvis-app && npm run dev`
Expected: server starts on localhost (default port 3000), no build errors printed.

- [ ] **Step 2: Sign in and navigate to the new tab**

Open the app in a browser, sign in as a member, and click the new "Air Hockey" tab in the nav bar. Confirm:
- The URL becomes `/air-hockey` and the TopBar/nav remain visible (not a full-screen takeover).
- The arena, stat panels (YOU / CPU), and "PRESS S FOR SOUND" indicator render.

- [ ] **Step 3: Play a rally and confirm stats update**

Move the mouse to hit the puck several times. Confirm:
- The mallet follows the cursor and stays clamped to the player's half of the table.
- Streak/top-speed/power-hit numbers in the YOU/CPU panels update on hits and goals.
- A goal produces a "GOAL!" flash and a screen-shake.

- [ ] **Step 4: Confirm game-point slo-mo and game over**

Play (or wait) until either side reaches 6 goals. Confirm:
- The screen dips into slow motion with letterbox bars and a "GAME POINT" label.
Continue until one side reaches 7. Confirm:
- The game-over overlay appears with the correct winner, face, "GAME · SET · MATCH" / "BETTER LUCK NEXT TIME" text, and final score.
- Winning triggers confetti; losing does not.
- Clicking "PLAY AGAIN" resets score/stats to 0 and dismisses the overlay.

- [ ] **Step 5: Confirm mute toggle**

Press `S`. Confirm the indicator text flips between "PRESS S FOR SOUND" and "PRESS S TO MUTE", and that sound plays on hits/goals once unmuted.

- [ ] **Step 6: Confirm no regressions elsewhere**

Click through Overview and Neural tabs. Confirm both still load and behave as before (Neural's full-screen takeover and greeting button still work).

- [ ] **Step 7: Stop the dev server**

Run: Ctrl-C in the terminal running `npm run dev`.

- [ ] **Step 8: Final status check**

Run: `cd jarvis-app && git status`
Expected: working tree clean (all changes committed in Tasks 1-7).
