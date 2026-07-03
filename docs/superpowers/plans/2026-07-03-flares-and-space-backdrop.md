# Prominence Flares + Space Backdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solar-prominence arcs erupt from the core on each spoken word, and the background becomes deep space (twinkling starfield + faint theme-tinted nebula).

**Architecture:** `FlareField` is a new self-contained module — a pooled `LineSegments` of bezier arcs whose lifecycle (erupt/decay) is pure CPU math and unit-testable headless (three geometry needs no WebGL until rendered). The scene wires it into `pulse()`/`greet()`/`animate()` in three one-liners. The backdrop is two new scene builders (stars, nebula) using ShaderMaterials, which are inherently immune to the scene's fog.

**Tech Stack:** three@0.158, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-flares-and-space-backdrop-design.md`

## Global Constraints

- Work happens inside `jarvis-app/`; run all npm commands from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`.
- Flare pool: 28 desktop / 14 mobile; 16 segments per arc; anchors on the core surface 25–60° apart; apex at `coreRadius * (1.6 + Math.random() * 0.8)`; eruption duration `0.5 + Math.random() * 0.3` s.
- Eruptions per word: `2 + Math.floor(Math.random() * 2)` (2–3); greet volley: 8; NONE under `prefers-reduced-motion` (the scene's existing `reduceMotion` field gates them).
- Stars: 2500 desktop / 1200 mobile, radii 220–420, sizes 0.6–2.2, 85% white / 10% cool `0xbfd4ff` / 5% warm `0xffe0b8`, twinkle `0.75 + 0.25 * sin(time * (0.5 + seed) + seed * 40.0)`; added to `this.scene` (not `mainGroup`).
- Nebula: sphere r=500, `THREE.BackSide`, 2-octave `snoise`, color `cSurface * n * 0.16`, alpha `n * 0.14`, `depthTest: false`, `renderOrder = -1`; added to `this.scene`.
- No new uniform entries anywhere — flare/star/nebula materials receive the scene's existing shared uniforms object.
- Only files named per task change. No dependency changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: FlareField module

**Files:**
- Create: `lib/neural/flares.ts`
- Test: `lib/neural/flares.test.ts`

**Interfaces:**
- Consumes: `three` only.
- Produces: `export type FlareUniforms = { time: { value: number }; cOrange: { value: THREE.Color }; cYellow: { value: THREE.Color } }` and `export class FlareField` with `constructor(coreRadius: number, uniforms: FlareUniforms, count: number)`, `readonly mesh: THREE.LineSegments`, `activate(n: number): void`, `update(delta: number): void`, `activeCount(): number`. Task 2 consumes exactly these.

- [ ] **Step 1: Write the failing test**

Create `lib/neural/flares.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Color } from "three";
import { FlareField } from "./flares";

const uniforms = () => ({
  time: { value: 0 },
  cOrange: { value: new Color(1, 0.4, 0) },
  cYellow: { value: new Color(1, 0.9, 0.2) },
});

describe("FlareField", () => {
  it("starts idle", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    expect(f.activeCount()).toBe(0);
  });

  it("activate erupts the requested number of idle arcs", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    f.activate(3);
    expect(f.activeCount()).toBe(3);
  });

  it("never exceeds the pool", () => {
    const f = new FlareField(2.2, uniforms(), 4);
    f.activate(99);
    expect(f.activeCount()).toBe(4);
    f.activate(5);
    expect(f.activeCount()).toBe(4);
  });

  it("update decays all lives to zero within a second", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    f.activate(5);
    f.update(1.0); // max eruption duration is 0.8s
    expect(f.activeCount()).toBe(0);
  });

  it("arcs can re-erupt after dying", () => {
    const f = new FlareField(2.2, uniforms(), 2);
    f.activate(2);
    f.update(1.0);
    f.activate(1);
    expect(f.activeCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/neural/flares.test.ts`
Expected: FAIL — cannot resolve `./flares`.

- [ ] **Step 3: Write the module**

Create `lib/neural/flares.ts`:

```ts
/**
 * FlareField — pooled solar-prominence arcs for the JARVIS magma core.
 *
 * A fixed pool of bezier arcs anchored on the core surface, all drawn as one
 * LineSegments mesh. Idle arcs are invisible (life 0). activate(n) erupts up
 * to n idle arcs at fresh random spots; update(delta) decays their lives. A
 * bright head glow travels along each arc as it dies, tinted by the scene's
 * shared cOrange/cYellow uniforms so theme switches re-tint eruptions for
 * free. Construction is pure CPU math (no WebGL context until rendered), so
 * the eruption lifecycle is unit-testable headless.
 */

import * as THREE from "three";

export type FlareUniforms = {
  time: { value: number };
  cOrange: { value: THREE.Color };
  cYellow: { value: THREE.Color };
};

const SEGMENTS = 16; // line segments per arc → SEGMENTS * 2 vertices

export class FlareField {
  readonly mesh: THREE.LineSegments;
  private readonly coreRadius: number;
  private readonly count: number;
  private readonly lives: Float32Array; // 1 → just erupted, 0 → idle
  private readonly durations: Float32Array; // seconds per eruption
  private readonly positions: Float32Array;
  private readonly lifeAttr: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor(coreRadius: number, uniforms: FlareUniforms, count: number) {
    this.coreRadius = coreRadius;
    this.count = count;
    this.lives = new Float32Array(count);
    this.durations = new Float32Array(count).fill(0.6);

    const vertsPerArc = SEGMENTS * 2;
    this.positions = new Float32Array(count * vertsPerArc * 3);
    this.lifeAttr = new Float32Array(count * vertsPerArc);
    const progress = new Float32Array(count * vertsPerArc);
    for (let a = 0; a < count; a++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const i = a * vertsPerArc + s * 2;
        progress[i] = s / SEGMENTS;
        progress[i + 1] = (s + 1) / SEGMENTS;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aProgress", new THREE.BufferAttribute(progress, 1));
    this.geometry.setAttribute("aLife", new THREE.BufferAttribute(this.lifeAttr, 1));

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute float aProgress;
        attribute float aLife;
        varying float vProgress;
        varying float vLife;
        void main() {
          vProgress = aProgress;
          vLife = aLife;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 cOrange;
        uniform vec3 cYellow;
        varying float vProgress;
        varying float vLife;
        void main() {
          if (vLife <= 0.0) discard;
          vec3 color = mix(cOrange, cYellow, vProgress);
          // A bright head races A→B as the arc dies; HDR gain feeds bloom.
          float head = exp(-abs(vProgress - (1.0 - vLife)) * 5.0);
          float envelope = pow(vLife, 0.6);
          color *= (0.35 + head * 2.2) * envelope * 3.0;
          float alpha = envelope * (0.25 + head * 0.75);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false; // arc positions rewrite per eruption; skip stale-bounds culling
  }

  /** Number of arcs currently erupting (life > 0). */
  activeCount(): number {
    let n = 0;
    for (let a = 0; a < this.count; a++) if (this.lives[a] > 0) n++;
    return n;
  }

  /** Erupt up to n idle arcs at fresh random positions on the core. */
  activate(n: number) {
    let remaining = n;
    for (let a = 0; a < this.count && remaining > 0; a++) {
      if (this.lives[a] > 0) continue;
      this.regenerateArc(a);
      this.lives[a] = 1;
      this.durations[a] = 0.5 + Math.random() * 0.3;
      remaining--;
    }
  }

  /** Decay eruption lives and push them into the vertex buffer. */
  update(delta: number) {
    const vertsPerArc = SEGMENTS * 2;
    let dirty = false;
    for (let a = 0; a < this.count; a++) {
      if (this.lives[a] <= 0) continue;
      this.lives[a] = Math.max(0, this.lives[a] - delta / this.durations[a]);
      this.lifeAttr.fill(this.lives[a], a * vertsPerArc, (a + 1) * vertsPerArc);
      dirty = true;
    }
    if (dirty) this.geometry.attributes.aLife.needsUpdate = true;
  }

  private regenerateArc(a: number) {
    const dirA = randomUnitVector();
    // Rotate dirA by 25–60° around a random perpendicular axis to get B.
    const axis = new THREE.Vector3().crossVectors(dirA, randomUnitVector()).normalize();
    const angle = (25 + Math.random() * 35) * (Math.PI / 180);
    const dirB = dirA.clone().applyAxisAngle(axis, angle);

    const A = dirA.multiplyScalar(this.coreRadius);
    const B = dirB.multiplyScalar(this.coreRadius);
    const apex = A.clone()
      .add(B)
      .normalize()
      .multiplyScalar(this.coreRadius * (1.6 + Math.random() * 0.8));
    const points = new THREE.QuadraticBezierCurve3(A, apex, B).getPoints(SEGMENTS);

    const vertsPerArc = SEGMENTS * 2;
    for (let s = 0; s < SEGMENTS; s++) {
      const i = (a * vertsPerArc + s * 2) * 3;
      this.positions[i] = points[s].x;
      this.positions[i + 1] = points[s].y;
      this.positions[i + 2] = points[s].z;
      this.positions[i + 3] = points[s + 1].x;
      this.positions[i + 4] = points[s + 1].y;
      this.positions[i + 5] = points[s + 1].z;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

function randomUnitVector(): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/neural/flares.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/neural/flares.ts lib/neural/flares.test.ts
git commit -m "$(cat <<'EOF'
Add FlareField prominence-arc pool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire flares into the scene

**Files:**
- Modify: `lib/neural/scene.ts`

**Interfaces:**
- Consumes: `FlareField` from `./flares` (Task 1) — `constructor(coreRadius, uniforms, count)`, `mesh`, `activate(n)`, `update(delta)`.
- Produces: eruptions on `pulse()`/`greet()`; nothing new downstream.

All edits are exact chunks against the current file. Apply in order.

- [ ] **Step 1: Import**

Replace:

```ts
import { THEMES } from "./themes";
```

with:

```ts
import { THEMES } from "./themes";
import { FlareField } from "./flares";
```

- [ ] **Step 2: Field**

Replace:

```ts
  private rafId = 0;
  private supported = true;
```

with:

```ts
  private rafId = 0;
  private supported = true;
  private flares: FlareField | null = null;
```

- [ ] **Step 3: Build in `init()`**

Replace:

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
```

with:

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
    this.flares = new FlareField(CORE_RADIUS, this.uniforms, this.isMobile ? 14 : 28);
    this.mainGroup.add(this.flares.mesh);
```

- [ ] **Step 4: Erupt on words and greeting**

Replace:

```ts
  /** Word-boundary punch: brightens vein pulse heads and the core. */
  pulse(count = 1) {
    this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.4 * count);
  }
```

with:

```ts
  /** Word-boundary punch: brightens vein pulse heads and the core. */
  pulse(count = 1) {
    this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.4 * count);
    if (!this.reduceMotion) this.flares?.activate(2 + Math.floor(Math.random() * 2));
  }
```

Then replace:

```ts
  /** Greeting surge: bloom + rotation + vein/core boost, decaying over ~4.5s. */
  greet() {
    this.greetLevel = 1;
  }
```

with:

```ts
  /** Greeting surge: bloom + rotation + vein/core boost, decaying over ~4.5s. */
  greet() {
    this.greetLevel = 1;
    if (!this.reduceMotion) this.flares?.activate(8);
  }
```

- [ ] **Step 5: Decay in `animate()`**

Replace:

```ts
    this.dustMesh.rotation.y += 0.02 * delta;
    this.controls.update();
    this.composer.render();
```

with:

```ts
    this.dustMesh.rotation.y += 0.02 * delta;
    this.flares?.update(delta);
    this.controls.update();
    this.composer.render();
```

- [ ] **Step 6: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean; 61 tests (56 + 5 from Task 1).

- [ ] **Step 7: Commit**

```bash
git add lib/neural/scene.ts
git commit -m "$(cat <<'EOF'
Erupt prominence flares from the core on spoken words

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Space backdrop — starfield + nebula

**Files:**
- Modify: `lib/neural/scene.ts`

**Interfaces:**
- Consumes: existing `this.uniforms` (`time`, `cSurface`), `snoise3GLSL`, `this.isMobile`, `this.scene`.
- Produces: nothing consumed elsewhere; both objects reaped by the existing dispose traverse (they join `this.scene`).

- [ ] **Step 1: Call the builders in `init()`**

Replace (note: this text includes Task 2's insertion — Task 2 must land first):

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
    this.flares = new FlareField(CORE_RADIUS, this.uniforms, this.isMobile ? 14 : 28);
    this.mainGroup.add(this.flares.mesh);
```

with:

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
    this.buildStars();
    this.buildNebula();
    this.flares = new FlareField(CORE_RADIUS, this.uniforms, this.isMobile ? 14 : 28);
    this.mainGroup.add(this.flares.mesh);
```

- [ ] **Step 2: Add both builder methods**

Insert immediately AFTER the closing brace of the `buildHalo()` method (before the `// ─── Animate ───…` comment):

```ts
  // ─── Space backdrop: distant starfield ─────────────────────────────────────
  // Far outside the fog's reach by construction (ShaderMaterials ignore fog).
  // Added to the scene root, not mainGroup, so it reads as a fixed sky.
  private buildStars() {
    const COUNT = this.isMobile ? 1200 : 2500;
    const positions = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const white = new THREE.Color(0xffffff);
    const cool = new THREE.Color(0xbfd4ff);
    const warm = new THREE.Color(0xffe0b8);
    for (let i = 0; i < COUNT; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      const r = 220 + Math.random() * 200;
      positions[i * 3] = dir.x * r;
      positions[i * 3 + 1] = dir.y * r;
      positions[i * 3 + 2] = dir.z * r;
      sizes[i] = 0.6 + Math.random() * 1.6;
      seeds[i] = Math.random();
      const t = Math.random();
      const c = t < 0.85 ? white : t < 0.95 ? cool : warm;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute float size;
        attribute float seed;
        attribute vec3 aColor;
        uniform float time;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vColor = aColor;
          vTwinkle = 0.75 + 0.25 * sin(time * (0.5 + seed) + seed * 40.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (600.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float falloff = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(vColor * vTwinkle, falloff * vTwinkle);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  // ─── Space backdrop: faint theme-tinted nebula haze ────────────────────────
  private buildNebula() {
    const geo = new THREE.SphereGeometry(500, 32, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 cSurface;
        varying vec3 vDir;
        ${snoise3GLSL}
        void main() {
          float n = snoise(vDir * 2.0 + time * 0.01) * 0.6
                  + snoise(vDir * 5.0 - time * 0.01) * 0.4;
          n = max(0.0, n);
          vec3 color = cSurface * n * 0.16;
          gl_FragColor = vec4(color, n * 0.14);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    this.scene.add(mesh);
  }
```

- [ ] **Step 3: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 61 tests.

- [ ] **Step 4: Commit**

```bash
git add lib/neural/scene.ts
git commit -m "$(cat <<'EOF'
Add deep-space backdrop: twinkling starfield and faint nebula

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
