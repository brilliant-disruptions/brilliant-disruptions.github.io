# Vein Boundary Halo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft fresnel-rim halo sphere at the vein-origin radius so the veins visibly emerge from a spherical energy field.

**Architecture:** One new private builder in `NeuralScene` sharing the existing uniforms — the halo is tinted by `cSurface` (the vein-origin color), so theme cross-fades apply with zero new wiring.

**Tech Stack:** three@0.158, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-03-vein-boundary-halo-design.md`

## Global Constraints

- Only `jarvis-app/lib/neural/scene.ts` changes; run npm commands from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`.
- No new uniforms, no theme changes, no `animate()` changes; halo color comes from the existing `cSurface` uniform.
- Halo constants: radius `OUTER_RADIUS * 0.995`, segments 64×64, fresnel power 3.5, color gain 1.6, max alpha 0.35, additive blending, `depthWrite: false`.
- Commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Add the halo builder

**Files:**
- Modify: `lib/neural/scene.ts`

**Interfaces:**
- Consumes: existing `this.uniforms` (specifically `cSurface`), `OUTER_RADIUS`, `this.mainGroup`.
- Produces: nothing consumed elsewhere; the mesh is disposed by the existing traverse in `dispose()`.

No unit test (GPU material — same compile-gated boundary as the rest of the scene, per the codebase convention).

- [ ] **Step 1: Call the builder from `init()`**

Replace:

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
```

with:

```ts
    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
```

- [ ] **Step 2: Add the builder method**

Insert immediately AFTER the closing brace of the `buildVeins()` method (before the `// ─── Animate ───…` comment):

```ts
  // ─── Boundary halo ─────────────────────────────────────────────────────────
  // A fresnel-rim sphere at the vein-origin radius: invisible face-on, a soft
  // luminous limb at the edges, so the veins read as born from an energy field.
  // Tinted by cSurface, so theme switches cross-fade it for free.
  private buildHalo() {
    const geo = new THREE.SphereGeometry(OUTER_RADIUS * 0.995, 64, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 cSurface;
        varying vec3 vNormal;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.5);
          vec3 color = cSurface * fresnel * 1.6;
          float alpha = fresnel * 0.35;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.Mesh(geo, mat));
  }
```

- [ ] **Step 3: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 56 tests.

- [ ] **Step 4: Commit**

```bash
git add lib/neural/scene.ts
git commit -m "$(cat <<'EOF'
Add fresnel boundary halo at the vein-origin sphere

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Theatrical voice drama

**Files:**
- Modify: `lib/neural/scene.ts`

**Interfaces:**
- Consumes: existing `uVoice`/`uPulse` uniforms, `pulseLevel`/`greetLevel` envelopes, `bloomPass`.
- Produces: nothing new — constant tuning only.

**Spec:** `docs/superpowers/specs/2026-07-03-theatrical-voice-drama-design.md` (value table is authoritative).

No unit test (shader/scene constants; compile-gated like the rest of the scene).

- [ ] **Step 1: Apply the seven value changes**

Each is a one-line replacement in `lib/neural/scene.ts`:

1. Core vertex shader — replace `float amp = 0.15 + uVoice * 0.30;` with `float amp = 0.15 + uVoice * 0.60;`
2. Core fragment shader — replace `color *= 1.5 + uVoice * 0.9 + uPulse * 0.4;` with `color *= 1.5 + uVoice * 1.8 + uPulse * 0.8;`
3. Vein fragment shader — replace `vec3 pulseGlow = color * pulse * (10.0 + uPulse * 18.0);` with `vec3 pulseGlow = color * pulse * (10.0 + uPulse * 30.0);`
4. Vein fragment shader — replace `float alphaPulse = pulse * (0.9 + uPulse * 0.5);` with `float alphaPulse = pulse * (0.9 + uPulse * 0.9);`
5. `animate()` — replace `this.pulseLevel *= Math.exp(-6 * delta);` with `this.pulseLevel *= Math.exp(-3.5 * delta);`
6. `pulse()` — replace `this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.2 * count);` with `this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.3 * count);`
7. `animate()` — replace `this.bloomPass.strength = 2.0 + this.greetLevel * 1.2;` with `this.bloomPass.strength = 2.0 + this.greetLevel * 1.2 + this.uniforms.uVoice.value * 0.9;`

If any snippet doesn't match exactly, STOP and report the mismatch.

- [ ] **Step 2: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 56 tests.

- [ ] **Step 3: Commit**

```bash
git add lib/neural/scene.ts
git commit -m "$(cat <<'EOF'
Turn up voice-reactive drama: bigger swell, lingering word surges, voice-driven bloom

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
