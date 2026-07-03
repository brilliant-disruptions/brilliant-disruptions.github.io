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
