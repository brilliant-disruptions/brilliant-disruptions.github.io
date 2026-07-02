# Neural Tab — Magma Core Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Neural tab's arc-reactor scene with the CodePen "magma core" Three.js visualization (molten core, ~1200 pulsing veins, Earth-outline globe, volcanoes, dust, bloom) with orbit controls, a three-palette theme switcher, and a voice-reactive core.

**Architecture:** Rewrite `lib/neural/scene.ts` in place, keeping its public API (`init`/`dispose`/`pulse`/`setVoiceLevel`/`greet`) and adding `setTheme(index)`. Theme palettes live in a new `lib/neural/themes.ts` (unit-testable data module). The page component keeps all its speech-synthesis wiring and loses the ENGAGE gate / boot sequence / HUD chrome. A new `ThemeSwitcher` React component replicates the pen's bottom-left glass pill.

**Tech Stack:** Next.js 16 (app router), React 19, TypeScript, `three@0.158` (already a dependency — includes all needed addons), Tailwind v4 + global CSS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-neural-magma-core-design.md`

## Global Constraints

- Work happens inside `jarvis-app/` — all paths below are relative to `jarvis-app/` unless prefixed with `docs/`.
- Use the existing `three@0.158`; do NOT upgrade. Addon imports use the `three/examples/jsm/...` path style (matches current `scene.ts`), not `three/addons/`.
- Keep the scene class name `NeuralScene` and its consumer-facing API: `init(): boolean`, `dispose()`, `pulse(count?: number)`, `setVoiceLevel(level: number)`, `greet()`, plus new `setTheme(index: number)`.
- Bloom parameters from the pen: strength 2.0, radius 0.5, threshold 0.85. Orbit controls: damping 0.05, autoRotate speed 0.8, distance 12–50. Camera: fov 45, position (15, 10, 25).
- Earth texture served locally from `public/textures/earth_specular_2048.jpg` — never hotlinked.
- Greeting copy is unchanged: `"Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online."`
- The greet button stays the audio-unlock user gesture (there is no ENGAGE gate anymore).
- Run all npm commands from `jarvis-app/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Theme palettes module + bundled Earth texture

**Files:**
- Create: `lib/neural/themes.ts`
- Create: `lib/neural/themes.test.ts`
- Create: `public/textures/earth_specular_2048.jpg` (downloaded asset)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `export type NeuralTheme` and `export const THEMES: NeuralTheme[]` (exactly 3 entries). Task 2 reads the `THREE.Color` fields; Task 3 reads `name`, `swatch`, `accent`. Field names: `name: string`, `swatch: string`, `accent: string`, `core: [THREE.Color, THREE.Color, THREE.Color, THREE.Color]`, `vein: { surface: THREE.Color; coreA: THREE.Color; coreB: THREE.Color }`, `boundary: THREE.Color`, `volcano: THREE.Color`, `dust: THREE.Color`, `bg: THREE.Color`.

- [ ] **Step 1: Download the Earth texture**

The pen hotlinks this from the three.js repo (MIT-licensed example asset); we bundle it.

```bash
mkdir -p public/textures
curl -L -o public/textures/earth_specular_2048.jpg \
  https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg
```

Verify: `file public/textures/earth_specular_2048.jpg` reports `JPEG image data` and the file is roughly 150–300 KB. If the download is an HTML error page, stop and report.

- [ ] **Step 2: Write the failing test**

Create `lib/neural/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Color } from "three";
import { THEMES } from "./themes";

describe("THEMES", () => {
  it("defines exactly three palettes", () => {
    expect(THEMES).toHaveLength(3);
    expect(THEMES.map((t) => t.name)).toEqual(["Magma & Cyan", "Neon Void", "Solar Flare"]);
  });

  it("every palette is complete", () => {
    for (const t of THEMES) {
      expect(t.core).toHaveLength(4);
      for (const c of t.core) expect(c).toBeInstanceOf(Color);
      expect(t.vein.surface).toBeInstanceOf(Color);
      expect(t.vein.coreA).toBeInstanceOf(Color);
      expect(t.vein.coreB).toBeInstanceOf(Color);
      expect(t.boundary).toBeInstanceOf(Color);
      expect(t.volcano).toBeInstanceOf(Color);
      expect(t.dust).toBeInstanceOf(Color);
      expect(t.bg).toBeInstanceOf(Color);
      expect(t.swatch).toContain("linear-gradient");
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- lib/neural/themes.test.ts`
Expected: FAIL — `Cannot find module './themes'` (or equivalent resolve error).

- [ ] **Step 4: Write the themes module**

Create `lib/neural/themes.ts`. Values are copied verbatim from the pen (the pen's unused `map`/`glass` fields are dropped; `swatch`/`accent` come from its thumb markup). Boundary colors intentionally exceed 1.0 — HDR values that bloom picks up.

```ts
/**
 * Theme palettes for the JARVIS magma-core scene.
 *
 * Each palette drives every color channel in the scene (core gradient, vein
 * pulses, globe outline, volcano points, dust, fog/background) plus the CSS
 * bits the ThemeSwitcher needs (thumb gradient + glow accent). The scene lerps
 * all channels toward the active palette each frame, so switching cross-fades.
 */

import { Color } from "three";

export type NeuralTheme = {
  name: string;
  /** CSS background for the switcher thumb. */
  swatch: string;
  /** CSS hex color for the switcher's rotating border + active glow. */
  accent: string;
  /** Core sphere gradient stops: dark → hot mid → bright → peak. */
  core: [Color, Color, Color, Color];
  vein: { surface: Color; coreA: Color; coreB: Color };
  /** Globe continent-outline color (HDR — values >1 feed bloom). */
  boundary: Color;
  volcano: Color;
  dust: Color;
  bg: Color;
};

export const THEMES: NeuralTheme[] = [
  {
    name: "Magma & Cyan",
    swatch: "linear-gradient(135deg, #00d2ff, #ff5500)",
    accent: "#00d2ff",
    core: [
      new Color(0.1, 0.0, 0.0),
      new Color(0.9, 0.05, 0.0),
      new Color(1.0, 0.4, 0.0),
      new Color(1.0, 0.9, 0.2),
    ],
    vein: {
      surface: new Color(0.0, 0.8, 1.0),
      coreA: new Color(0.8, 0.1, 0.0),
      coreB: new Color(1.0, 0.6, 0.0),
    },
    boundary: new Color(0.0, 1.5, 3.0),
    volcano: new Color(0xff5500),
    dust: new Color(0x223355),
    bg: new Color(0x010102),
  },
  {
    name: "Neon Void",
    swatch: "linear-gradient(135deg, #ff00ff, #00ff00)",
    accent: "#ff00ff",
    core: [
      new Color(0.05, 0.0, 0.1),
      new Color(0.5, 0.0, 0.5),
      new Color(1.0, 0.0, 0.8),
      new Color(1.0, 0.5, 1.0),
    ],
    vein: {
      surface: new Color(0.2, 1.0, 0.2),
      coreA: new Color(0.8, 0.0, 0.8),
      coreB: new Color(0.0, 0.8, 1.0),
    },
    boundary: new Color(2.0, 0.0, 1.5),
    volcano: new Color(0x00ff00),
    dust: new Color(0x2a0044),
    bg: new Color(0x020005),
  },
  {
    name: "Solar Flare",
    swatch: "linear-gradient(135deg, #0055ff, #ffdd00)",
    accent: "#ffdd00",
    core: [
      new Color(0.05, 0.02, 0.0),
      new Color(0.8, 0.4, 0.0),
      new Color(1.0, 0.8, 0.2),
      new Color(1.5, 1.5, 1.5),
    ],
    vein: {
      surface: new Color(0.0, 0.3, 2.0),
      coreA: new Color(1.0, 0.8, 0.0),
      coreB: new Color(1.0, 0.3, 0.0),
    },
    boundary: new Color(1.5, 1.5, 2.5),
    volcano: new Color(0xffffff),
    dust: new Color(0x443311),
    bg: new Color(0x000103),
  },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/neural/themes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/neural/themes.ts lib/neural/themes.test.ts public/textures/earth_specular_2048.jpg
git commit -m "$(cat <<'EOF'
Add neural theme palettes and bundled Earth texture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewrite NeuralScene as the magma core

**Files:**
- Modify: `lib/neural/scene.ts` (full rewrite — replace entire contents)

**Interfaces:**
- Consumes: `THEMES` from `./themes` (Task 1).
- Produces: `export class NeuralScene` with `constructor(canvas: HTMLCanvasElement)`, `init(): boolean`, `dispose(): void`, `pulse(count?: number): void`, `setVoiceLevel(level: number): void`, `greet(): void`, `setTheme(index: number): void`, `isSupported(): boolean`. Task 4's page calls exactly these.

No unit test for this task: the class is a WebGL render loop (needs a GPU context; jsdom/vitest can't exercise it, and the existing codebase has no scene tests either). Verification is the type/lint gate here plus the manual visual check in Task 4.

- [ ] **Step 1: Replace `lib/neural/scene.ts` with the magma-core implementation**

The pen's script, restructured as a class. Voice-reactivity additions over the pen are marked with `uVoice`/`uPulse` uniforms: voice swells the core's displacement and glow; pulses brighten the vein flow heads; `greet()` drives a slow-decaying surge that also boosts bloom and auto-rotate speed.

```ts
/**
 * NeuralScene — the JARVIS "magma core" for the Neural tab.
 *
 * A molten noise-displaced core sphere wrapped in ~1200 bezier energy veins
 * that pulse inward from an Earth-outline globe shell, with volcano points,
 * a dust field, bloom post-processing and orbit controls. Ported from
 * https://codepen.io/VoXelo/pen/RNGRQBo and made voice-reactive: the page
 * feeds a speech envelope via setVoiceLevel()/pulse() and the core visibly
 * swells with each word JARVIS speaks.
 *
 * Framework-agnostic: construct with a <canvas>, call init(), drive with
 * setVoiceLevel()/pulse()/greet()/setTheme(), and dispose() on unmount.
 * Used by the React page at app/(app)/neural/page.tsx.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { THEMES } from "./themes";

const CORE_RADIUS = 2.2;
const OUTER_RADIUS = 10.0;
const POINTS_PER_VEIN = 45;
const THEME_LERP = 0.05; // per-frame color convergence, as in the pen

// Ashima simplex noise, verbatim from the pen.
const snoise3GLSL = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute( i.z + vec4(0.0, i1.z, i2.z, 1.0 )) + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }
`;

function randomPointOnSphere(radius: number): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  );
}

export class NeuralScene {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock!: THREE.Clock;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private controls!: OrbitControls;
  private mainGroup!: THREE.Group;
  private dustMesh!: THREE.Points;
  private dustMat!: THREE.PointsMaterial;
  private volcanoMat!: THREE.ShaderMaterial;
  private earthTex: THREE.Texture | null = null;
  private rafId = 0;
  private supported = true;

  private themeIndex = 0;
  private voiceLevel = 0;
  private voiceTarget = 0;
  private pulseLevel = 0;
  private greetLevel = 0;

  private readonly isMobile: boolean;
  private readonly NUM_VEINS: number;
  private readonly DUST_COUNT: number;

  // Shared across core / vein / globe materials; volcano shares time + uPulse.
  private uniforms = {
    time: { value: 0 },
    uVoice: { value: 0 },
    uPulse: { value: 0 },
    cDark: { value: THEMES[0].core[0].clone() },
    cRed: { value: THEMES[0].core[1].clone() },
    cOrange: { value: THEMES[0].core[2].clone() },
    cYellow: { value: THEMES[0].core[3].clone() },
    cSurface: { value: THEMES[0].vein.surface.clone() },
    cCoreA: { value: THEMES[0].vein.coreA.clone() },
    cCoreB: { value: THEMES[0].vein.coreB.clone() },
    boundaryColor: { value: THEMES[0].boundary.clone() },
    tEarth: { value: null as THREE.Texture | null },
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    this.NUM_VEINS = this.isMobile ? 600 : 1200;
    this.DUST_COUNT = this.isMobile ? 1000 : 2000;
    this.onResize = this.onResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  isSupported() {
    return this.supported;
  }

  init(): boolean {
    const hasWebGL = (() => {
      try {
        return !!(
          window.WebGLRenderingContext &&
          (this.canvas.getContext("webgl") || this.canvas.getContext("experimental-webgl"))
        );
      } catch {
        return false;
      }
    })();
    if (!hasWebGL) {
      this.supported = false;
      return false;
    }

    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(THEMES[0].bg.getHex(), 0.012);
    this.renderer.setClearColor(this.scene.fog.color);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(15, 10, 25);

    this.earthTex = new THREE.TextureLoader().load("/textures/earth_specular_2048.jpg");
    this.uniforms.tEarth.value = this.earthTex;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      2.0, // strength
      0.5, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.maxDistance = 50;
    this.controls.minDistance = 12;

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildGlobe();
    this.buildVolcanoes();

    window.addEventListener("resize", this.onResize);
    this.animate();
    return true;
  }

  // ─── Dust field ────────────────────────────────────────────────────────────
  private buildDust() {
    const positions = new Float32Array(this.DUST_COUNT * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 100;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dustMat = new THREE.PointsMaterial({
      color: THEMES[0].dust.clone(),
      size: 0.1,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dustMesh = new THREE.Points(geo, this.dustMat);
    this.scene.add(this.dustMesh);
  }

  // ─── Molten core ───────────────────────────────────────────────────────────
  private buildCore() {
    const geo = new THREE.SphereGeometry(CORE_RADIUS, 128, 128);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float time;
        uniform float uVoice;
        varying vec3 vPosition;
        varying vec3 vNormal;
        ${snoise3GLSL}
        void main() {
          vPosition = position;
          vNormal = normal;
          // Voice swells the surface: displacement grows from the pen's 0.15
          // up to ~0.45 while JARVIS speaks.
          float amp = 0.15 + uVoice * 0.30;
          float displacement = snoise(position * 1.8 + time * 0.4) * amp;
          vec3 newPosition = position + normal * displacement;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float uVoice;
        uniform float uPulse;
        uniform vec3 cDark;
        uniform vec3 cRed;
        uniform vec3 cOrange;
        uniform vec3 cYellow;
        varying vec3 vPosition;
        varying vec3 vNormal;
        ${snoise3GLSL}
        void main() {
          float n1 = snoise(vPosition * 1.5 - time * 0.5);
          float n2 = snoise(vPosition * 4.0 + time * 0.3);
          float noiseVal = n1 * 0.6 + n2 * 0.4;

          vec3 color;
          if (noiseVal < -0.1) {
            color = mix(cDark, cRed, smoothstep(-0.5, -0.1, noiseVal));
          } else if (noiseVal < 0.3) {
            color = mix(cRed, cOrange, smoothstep(-0.1, 0.3, noiseVal));
          } else {
            color = mix(cOrange, cYellow, smoothstep(0.3, 0.8, noiseVal));
          }

          float fresnel = dot(vNormal, vec3(0.0, 0.0, 1.0));
          fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
          color += cOrange * pow(fresnel, 2.0) * 0.8;

          // Glow boost while speaking / pulsing.
          color *= 1.5 + uVoice * 0.9 + uPulse * 0.4;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.mainGroup.add(new THREE.Mesh(geo, mat));
  }

  // ─── Energy veins ──────────────────────────────────────────────────────────
  private buildVeins() {
    const positions: number[] = [];
    const progress: number[] = [];
    const offsets: number[] = [];
    const rands: number[] = [];

    for (let i = 0; i < this.NUM_VEINS; i++) {
      const start = randomPointOnSphere(OUTER_RADIUS);
      const end = start.clone().normalize().multiplyScalar(CORE_RADIUS * 0.85);

      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      mid.normalize().multiplyScalar(OUTER_RADIUS * 0.55);
      const tangent = new THREE.Vector3().crossVectors(start, new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(start, tangent).normalize();
      mid.add(tangent.multiplyScalar((Math.random() - 0.5) * 6));
      mid.add(bitangent.multiplyScalar((Math.random() - 0.5) * 6));

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(POINTS_PER_VEIN); // returns POINTS_PER_VEIN + 1 points
      const offset = Math.random();
      const rand = Math.random();

      for (let j = 0; j < POINTS_PER_VEIN; j++) {
        positions.push(points[j].x, points[j].y, points[j].z);
        positions.push(points[j + 1].x, points[j + 1].y, points[j + 1].z);
        progress.push(j / POINTS_PER_VEIN, (j + 1) / POINTS_PER_VEIN);
        offsets.push(offset, offset);
        rands.push(rand, rand);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("progress", new THREE.Float32BufferAttribute(progress, 1));
    geo.setAttribute("offset", new THREE.Float32BufferAttribute(offsets, 1));
    geo.setAttribute("randomSeed", new THREE.Float32BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute float progress;
        attribute float offset;
        attribute float randomSeed;
        varying float vProgress;
        varying float vOffset;
        varying float vRandom;
        void main() {
          vProgress = progress;
          vOffset = offset;
          vRandom = randomSeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float uPulse;
        uniform vec3 cSurface;
        uniform vec3 cCoreA;
        uniform vec3 cCoreB;
        varying float vProgress;
        varying float vOffset;
        varying float vRandom;
        void main() {
          vec3 targetCoreColor = mix(cCoreA, cCoreB, vRandom);
          vec3 color = mix(cSurface, targetCoreColor, pow(vProgress, 1.5));

          float speed = 0.3;
          float phase = vProgress - time * speed + vOffset * 10.0;
          float flow = fract(phase);
          float pulse = exp(-flow * 10.0);

          // uPulse brightens the traveling heads on each spoken word.
          vec3 pulseGlow = color * pulse * (10.0 + uPulse * 18.0);
          color += pulseGlow;

          float alphaBase = 0.02;
          float alphaPulse = pulse * (0.9 + uPulse * 0.5);
          float alpha = alphaBase + alphaPulse;

          alpha *= smoothstep(0.0, 0.05, vProgress) * smoothstep(1.0, 0.8, vProgress);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.LineSegments(geo, mat));
  }

  // ─── Earth-outline globe shell ─────────────────────────────────────────────
  private buildGlobe() {
    const geo = new THREE.SphereGeometry(OUTER_RADIUS * 0.995, 128, 128);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tEarth;
        uniform vec3 boundaryColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vec2 texel = vec2(1.5 / 2048.0, 1.5 / 1024.0);

          float c = texture2D(tEarth, vUv).r;
          float r = texture2D(tEarth, vUv + vec2(texel.x, 0.0)).r;
          float u = texture2D(tEarth, vUv + vec2(0.0, texel.y)).r;
          float l = texture2D(tEarth, vUv + vec2(-texel.x, 0.0)).r;
          float d = texture2D(tEarth, vUv + vec2(0.0, -texel.y)).r;

          float edge = abs(4.0 * c - r - u - l - d);
          float outline = smoothstep(0.1, 0.8, edge);

          vec3 color = boundaryColor * outline;
          color *= 2.5;

          float fresnel = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
          color += boundaryColor * fresnel * 0.5;

          float alpha = outline * 0.8 + fresnel * 0.2;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.Mesh(geo, mat));
  }

  // ─── Volcano points ────────────────────────────────────────────────────────
  private buildVolcanoes() {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 150; i++) points.push(randomPointOnSphere(OUTER_RADIUS));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    this.volcanoMat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: THEMES[0].volcano.clone() },
        size: { value: 7.0 * Math.min(window.devicePixelRatio, 2) },
        time: this.uniforms.time,
      },
      vertexShader: `
        uniform float size;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (20.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        void main() {
          vec2 pt = gl_PointCoord - vec2(0.5);
          if (abs(pt.x) > 0.35 || abs(pt.y) > 0.35) discard;
          float throb = sin(time * 3.0 + gl_FragCoord.x) * 0.5 + 0.5;
          gl_FragColor = vec4(color * (1.5 + throb), 0.9);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.Points(geo, this.volcanoMat));
  }

  // ─── Animate ──────────────────────────────────────────────────────────────
  private animate() {
    this.rafId = requestAnimationFrame(this.animate);
    if (typeof document !== "undefined" && document.hidden) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.uniforms.time.value = this.clock.getElapsedTime();

    // Envelopes: voice chases its target fast; word pulses decay quickly;
    // the greet surge decays over ~4.5s (matches the page's active window).
    this.voiceLevel += (this.voiceTarget - this.voiceLevel) * Math.min(1, delta * 14);
    this.pulseLevel *= Math.exp(-6 * delta);
    this.greetLevel *= Math.exp(-0.8 * delta);
    this.uniforms.uVoice.value = Math.min(1, this.voiceLevel + this.greetLevel * 0.5);
    this.uniforms.uPulse.value = Math.min(1.5, this.pulseLevel + this.greetLevel);

    // Cross-fade every color channel toward the active theme (pen behavior).
    const tgt = THEMES[this.themeIndex];
    this.uniforms.cDark.value.lerp(tgt.core[0], THEME_LERP);
    this.uniforms.cRed.value.lerp(tgt.core[1], THEME_LERP);
    this.uniforms.cOrange.value.lerp(tgt.core[2], THEME_LERP);
    this.uniforms.cYellow.value.lerp(tgt.core[3], THEME_LERP);
    this.uniforms.cSurface.value.lerp(tgt.vein.surface, THEME_LERP);
    this.uniforms.cCoreA.value.lerp(tgt.vein.coreA, THEME_LERP);
    this.uniforms.cCoreB.value.lerp(tgt.vein.coreB, THEME_LERP);
    this.uniforms.boundaryColor.value.lerp(tgt.boundary, THEME_LERP);
    (this.volcanoMat.uniforms.color.value as THREE.Color).lerp(tgt.volcano, THEME_LERP);
    this.dustMat.color.lerp(tgt.dust, THEME_LERP);
    (this.scene.fog as THREE.FogExp2).color.lerp(tgt.bg, THEME_LERP);
    this.renderer.setClearColor((this.scene.fog as THREE.FogExp2).color);

    this.bloomPass.strength = 2.0 + this.greetLevel * 1.2;
    this.controls.autoRotateSpeed = 0.8 + this.greetLevel * 2.0;

    this.dustMesh.rotation.y += 0.02 * delta;
    this.controls.update();
    this.composer.render();
  }

  // ─── Public controls ──────────────────────────────────────────────────────
  /** Word-boundary punch: brightens vein pulse heads and the core. */
  pulse(count = 1) {
    this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.2 * count);
  }

  /** Drive the core's voice swell (0..1). Page feeds a speech envelope here. */
  setVoiceLevel(level: number) {
    this.voiceTarget = Math.max(0, Math.min(1, level || 0));
  }

  /** Greeting surge: bloom + rotation + vein/core boost, decaying over ~4.5s. */
  greet() {
    this.greetLevel = 1;
  }

  /** Set the active palette; colors cross-fade toward it each frame. */
  setTheme(index: number) {
    this.themeIndex = Math.max(0, Math.min(THEMES.length - 1, Math.floor(index)));
  }

  private onResize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.controls?.dispose();
    this.scene?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.earthTex?.dispose();
    this.composer?.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
```

Notes for the implementer:

- The old file exported `NeuralState`, `setState()`, `setAmplitude()`, and mouse-parallax code — all gone. Only the page consumes this module, and Task 4 rewrites the page; a transient type error in `page.tsx` (`setState`/`NeuralState` no longer exist) until Task 4 lands is expected. `npm run lint` may flag the page in this window — that's fine; the gate for THIS task is that `scene.ts` itself is clean.
- `OrbitControls` attaches to `this.canvas` (not `document.body`) so overlay UI doesn't eat drag events.
- The renderer is opaque (`alpha: false`) and clear color follows the fog, exactly like the pen.

- [ ] **Step 2: Type-check the new module in isolation**

Run: `npx tsc --noEmit 2>&1 | grep -v "app/(app)/neural/page.tsx" ; npx tsc --noEmit 2>&1 | grep "lib/neural/scene.ts" | head -20`
Expected: no lines mentioning `lib/neural/scene.ts`. (Errors in `page.tsx` are expected until Task 4.)

- [ ] **Step 3: Run the unrelated test suite to confirm nothing else broke**

Run: `npm run test`
Expected: PASS — the themes, metrics, rules, triage, and monorepo tests all green (vitest never imports `scene.ts`).

- [ ] **Step 4: Commit**

```bash
git add lib/neural/scene.ts
git commit -m "$(cat <<'EOF'
Rewrite NeuralScene as voice-reactive magma core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ThemeSwitcher component + CSS

**Files:**
- Create: `components/neural/ThemeSwitcher.tsx`
- Modify: `app/globals.css` (append theme-switcher styles at the end)

**Interfaces:**
- Consumes: `THEMES` (`name`, `swatch`, `accent`) from `@/lib/neural/themes` (Task 1).
- Produces: `export function ThemeSwitcher({ active, onChange }: { active: number; onChange: (index: number) => void })`. Task 4 renders it inside a `pointer-events-none` overlay — the component root must set `pointer-events-auto` itself.

- [ ] **Step 1: Append switcher styles to `app/globals.css`**

The pen's `#theme-panel` CSS, renamed with a `theme-` prefix to avoid collisions:

```css
/* ── Neural theme switcher (magma core) ────────────────────────────────── */
.theme-switcher {
  position: relative;
  padding: 2px;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
}
.theme-switcher-border {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: conic-gradient(transparent, transparent, transparent, var(--theme-color, #00d2ff));
  animation: theme-rotate-border 4s linear infinite;
}
@keyframes theme-rotate-border {
  to {
    transform: rotate(360deg);
  }
}
.theme-switcher-content {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 8px;
  padding: 10px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(10, 12, 18, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.theme-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  box-sizing: border-box;
  border: 2px solid transparent;
  transition:
    transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275),
    border-color 0.2s,
    box-shadow 0.2s;
}
.theme-thumb:hover {
  transform: scale(1.15);
}
.theme-thumb.active {
  border-color: #ffffff;
  box-shadow: 0 0 10px var(--theme-color, #ffffff);
  transform: scale(1.15);
}
```

- [ ] **Step 2: Create `components/neural/ThemeSwitcher.tsx`**

```tsx
"use client";

/**
 * ThemeSwitcher — the magma-core palette picker: a glass pill with a rotating
 * conic-gradient border and one gradient swatch per theme. Renders inside the
 * Neural page's pointer-events-none overlay, so it re-enables pointer events
 * on its root.
 */

import type { CSSProperties } from "react";
import { THEMES } from "@/lib/neural/themes";

export function ThemeSwitcher({
  active,
  onChange,
}: {
  active: number;
  onChange: (index: number) => void;
}) {
  return (
    <div
      className="theme-switcher pointer-events-auto"
      style={{ "--theme-color": THEMES[active].accent } as CSSProperties}
    >
      <div aria-hidden className="theme-switcher-border" />
      <div className="theme-switcher-content">
        {THEMES.map((t, i) => (
          <button
            key={t.name}
            type="button"
            title={t.name}
            aria-label={`${t.name} theme`}
            aria-pressed={i === active}
            onClick={() => onChange(i)}
            className={`theme-thumb ${i === active ? "active" : ""}`}
            style={{ background: t.swatch }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "ThemeSwitcher" ; echo "---done---"`
Expected: only `---done---` (no errors mentioning ThemeSwitcher; page.tsx errors from Task 2 may still exist and are fine).

- [ ] **Step 4: Commit**

```bash
git add components/neural/ThemeSwitcher.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add ThemeSwitcher for the magma-core neural scene

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite the Neural page, delete dead HUD components, verify

**Files:**
- Modify: `app/(app)/neural/page.tsx` (full rewrite — replace entire contents)
- Delete: `components/neural/BootSequence.tsx`, `components/neural/HudPanels.tsx`, `components/neural/HudRings.tsx`

**Interfaces:**
- Consumes: `NeuralScene` (`init`, `dispose`, `pulse`, `setVoiceLevel`, `greet`, `setTheme`) from Task 2; `ThemeSwitcher({ active, onChange })` from Task 3; existing `HudSound` (`unlock`, `powerUp`, `dispose`) — unchanged.
- Produces: the final page; nothing downstream.

- [ ] **Step 1: Replace `app/(app)/neural/page.tsx`**

All speech-synthesis code (voice picking, envelope, boundary fallback) is carried over from the current file unchanged; what's removed is the `Phase` state machine, ENGAGE gate, boot sequence, HUD rings/panels, scanlines, gold frame, and the `speaking` React state (it only fed `HudPanels`). The greet button now also unlocks audio (it's the first user gesture).

```tsx
"use client";

/**
 * JARVIS Neural Interface — a member-gated, full-screen magma core.
 *
 * A molten noise-displaced core wrapped in energy veins that pulse inward from
 * an Earth-outline globe (Three.js + bloom + orbit controls). The "Hi, I'm
 * JARVIS" button unlocks audio, fires a power-up cue and speaks a greeting
 * while the core swells with each word. Theme switcher bottom-left.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeuralScene } from "@/lib/neural/scene";
import { HudSound } from "@/lib/neural/sound";
import { ThemeSwitcher } from "@/components/neural/ThemeSwitcher";

const GREETING = "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.";

export default function NeuralPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NeuralScene | null>(null);
  const soundRef = useRef<HudSound | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const boundaryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const synthUnlockedRef = useRef(false);
  const voiceRaf = useRef(0);
  const voiceSpike = useRef(0);

  const [active, setActive] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [theme, setTheme] = useState(0);

  // ─── Scene + sound lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new NeuralScene(canvasRef.current);
    const ok = scene.init();
    sceneRef.current = scene;
    setWebglOk(ok);
    soundRef.current = new HudSound();
    return () => {
      if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
      scene.dispose();
      sceneRef.current = null;
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  // ─── Speech synthesis ──────────────────────────────────────────────────────
  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Score voices toward the most human-sounding option a device exposes:
    // neural / "Online (Natural)" voices read far more realistically than the
    // older local ones. Prefer a British male neural voice, degrade gracefully.
    const pool = voices.filter((v) => /^en/i.test(v.lang));
    const candidates = pool.length ? pool : voices;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/natural|neural/.test(n)) s += 100; // neural engine = realistic
      if (/online/.test(n)) s += 40; // online neural voices
      if (!v.localService) s += 8; // remote voices are usually the neural ones
      if (/en[-_]gb/i.test(v.lang)) s += 30; // British
      else if (/^en/i.test(v.lang)) s += 10;
      if (/(ryan|george|thomas|arthur|daniel|oliver|brian|guy)\b/.test(n) || /\bmale\b/.test(n)) s += 20;
      if (/google uk english male/.test(n)) s += 25;
      if (/google/.test(n)) s += 6;
      return s;
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? voices[0];
  }, []);

  const stopBoundaryFallback = useCallback(() => {
    if (boundaryTimer.current) {
      clearInterval(boundaryTimer.current);
      boundaryTimer.current = null;
    }
  }, []);

  const startBoundaryFallback = useCallback(
    (text: string) => {
      const perPulse = 180;
      const est = Math.max(1200, (text.length / 12) * 1000);
      let elapsed = 0;
      boundaryTimer.current = setInterval(() => {
        elapsed += perPulse;
        sceneRef.current?.pulse(2);
        voiceSpike.current = 0.55 + Math.random() * 0.3;
        if (elapsed >= est) stopBoundaryFallback();
      }, perPulse);
    },
    [stopBoundaryFallback],
  );

  // While speaking, feed the core a continuous voice envelope (a smooth shimmer
  // plus a punch on every word) so the magma surface swells like it's the one
  // talking. The browser won't expose the real TTS waveform, so this is a
  // believable synthesized envelope synced to the speech timing.
  const startVoiceEnvelope = useCallback(() => {
    if (voiceRaf.current) return;
    const loop = () => {
      voiceRaf.current = requestAnimationFrame(loop);
      voiceSpike.current *= 0.86; // per-word punches decay
      const t = performance.now() / 1000;
      const shimmer = 0.3 + 0.16 * Math.sin(t * 11) + 0.1 * Math.sin(t * 17.3 + 1);
      sceneRef.current?.setVoiceLevel(Math.min(1, shimmer * 0.55 + voiceSpike.current));
    };
    loop();
  }, []);
  const stopVoiceEnvelope = useCallback(() => {
    if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
    voiceRaf.current = 0;
    voiceSpike.current = 0;
    sceneRef.current?.setVoiceLevel(0);
  }, []);

  const speak = useCallback(
    (text: string) => {
      speakingRef.current = true;
      startVoiceEnvelope();
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const done = () => {
        speakingRef.current = false;
        stopBoundaryFallback();
        stopVoiceEnvelope();
      };
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        startBoundaryFallback(text);
        setTimeout(done, Math.max(1500, (text.length / 12) * 1000));
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Light touch: neural voices sound most human near their natural pitch, so
      // we only nudge slightly for a calm, measured delivery.
      u.rate = 0.97;
      u.pitch = 0.96;
      u.lang = "en-GB";
      if (!voiceRef.current) voiceRef.current = pickVoice();
      if (voiceRef.current) u.voice = voiceRef.current;

      let gotBoundary = false;
      u.onstart = () => {
        setTimeout(() => {
          if (!gotBoundary && speakingRef.current) startBoundaryFallback(text);
        }, 280);
      };
      u.onboundary = () => {
        gotBoundary = true;
        sceneRef.current?.pulse(2);
        voiceSpike.current = 0.65 + Math.random() * 0.35;
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [pickVoice, startBoundaryFallback, stopBoundaryFallback, startVoiceEnvelope, stopVoiceEnvelope],
  );

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    voiceRef.current = pickVoice();
    const onVoices = () => {
      voiceRef.current = pickVoice();
    };
    synth.addEventListener("voiceschanged", onVoices);
    const onHidden = () => {
      if (document.hidden) synth.cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      synth.removeEventListener("voiceschanged", onVoices);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pickVoice]);

  const unlockSynthesis = () => {
    if (synthUnlockedRef.current) return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    synthUnlockedRef.current = true;
  };

  // ─── Interactions ──────────────────────────────────────────────────────────
  const onThemeChange = (i: number) => {
    setTheme(i);
    sceneRef.current?.setTheme(i);
  };

  const onGreet = () => {
    if (active) return;
    setActive(true);
    soundRef.current?.unlock(); // first user gesture unlocks audio
    soundRef.current?.powerUp();
    unlockSynthesis();
    sceneRef.current?.greet();
    speak(GREETING);
    window.setTimeout(() => setActive(false), 4500);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#04060a] text-[var(--white)]">
      {/* Canvas keeps pointer events — OrbitControls listens on it. */}
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      {!webglOk && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 42% 50%, rgba(0,229,255,0.28), transparent 28%), radial-gradient(circle at 58% 50%, rgba(124,58,237,0.28), transparent 28%)",
            filter: "blur(8px)",
          }}
        />
      )}

      {/* UI overlay — transparent to drags except its own controls. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-8">
        <header className="flex items-center justify-between">
          <Link
            href="/overview"
            className="pointer-events-auto font-mono text-xs tracking-widest text-[var(--muted-hi)] transition hover:text-[var(--cyan)]"
          >
            ← CONSOLE
          </Link>
        </header>

        <footer className="relative flex items-end">
          <ThemeSwitcher active={theme} onChange={onThemeChange} />
          <div className="absolute left-1/2 -translate-x-1/2">
            <button
              onClick={onGreet}
              disabled={active}
              className="pointer-events-auto px-9 py-4 font-display text-base font-semibold tracking-wide backdrop-blur transition disabled:opacity-80"
              style={{
                clipPath:
                  "polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px))",
                background: active ? "rgba(255,179,71,0.14)" : "rgba(0,229,255,0.1)",
                border: `1.5px solid ${active ? "var(--gold)" : "var(--cyan)"}`,
                color: active ? "var(--gold-bright)" : "var(--white)",
                boxShadow: active ? "0 0 36px rgba(255,179,71,0.45)" : "0 0 24px rgba(0,229,255,0.3)",
              }}
            >
              {active ? "JARVIS ONLINE…" : "Hi, I'm JARVIS"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the HUD components are now unreferenced, then delete them**

Run: `grep -rn "BootSequence\|HudPanels\|HudRings" app components lib`
Expected: no output. Then:

```bash
git rm components/neural/BootSequence.tsx components/neural/HudPanels.tsx components/neural/HudRings.tsx
```

If grep finds references outside the neural page, stop and report — do not delete.

- [ ] **Step 3: Full gate — types, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all three pass with no errors (the Task 2 transient page errors are gone now).

- [ ] **Step 4: Manual visual verification on the dev server**

A dev server may already be running on port 3000 (`npm run dev` from `jarvis-app/`; if not running, start it). Then verify at `http://localhost:3000/neural` (requires the user's login — ask the user to check if not authenticated):

1. Magma core renders with veins, Earth outlines, volcano points, dust, bloom.
2. Drag rotates the view; scroll zooms (clamped); scene auto-rotates when idle.
3. Clicking each theme swatch cross-fades all colors (core, veins, outlines, fog) and moves the white ring + glow to the clicked thumb.
4. "Hi, I'm JARVIS" speaks the greeting; the core visibly swells per word; vein pulses brighten; effect subsides after the greeting.
5. "← CONSOLE" navigates back to `/overview`; returning to `/neural` boots a fresh scene with no console errors about lost WebGL contexts.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/neural/page.tsx"
git commit -m "$(cat <<'EOF'
Rebuild Neural page around the magma core; drop HUD chrome

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

(The `git rm` from Step 2 is already staged and lands in this commit.)
