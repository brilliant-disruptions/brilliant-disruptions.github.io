# Neural Tab — Prominence Flares + Space Backdrop

**Date:** 2026-07-03
**Status:** Approved
**Target:** `jarvis-app` — the `/neural` scene

## Goal

Two user-confirmed additions:

1. **Prominence flares:** solar-prominence arcs erupt from the core surface on
   each spoken word, rise, collapse and fade over ~0.5–0.8 s. User picked arcs
   over particle jets.
2. **Space backdrop:** the background should read as deep space — a distant
   starfield with subtle twinkle plus a very faint theme-tinted nebula haze.
   User picked "starfield + faint nebula" over pure stars or a dense galaxy.

## Design

### 1. `lib/neural/flares.ts` — new `FlareField` (own module)

- `constructor(coreRadius: number, uniforms: FlareUniforms, count: number)`
  where `FlareUniforms` is a structural type carrying the scene's shared
  `time`, `cOrange`, `cYellow` uniform entries (the scene passes its existing
  uniforms object; no new uniform entries are created).
- **Pool:** `count` arcs (scene passes 28 desktop / 14 mobile), all in ONE
  `THREE.LineSegments` mesh. Each arc: 16 segments (32 vertices). Idle arcs
  have life 0 → alpha 0 (invisible, no per-frame cost beyond the buffer).
- **Arc shape (regenerated per eruption):** anchor A = random point on the
  core surface; anchor B = A's direction perturbed by a random 25–60° rotation,
  also on the surface; apex = normalized midpoint of A,B scaled to
  `coreRadius * (1.6 + Math.random() * 0.8)`; the arc is a
  `THREE.QuadraticBezierCurve3(A, apex, B)` sampled at 17 points.
- **Attributes:** static per-vertex `aProgress` (0..1 along the arc); per-frame
  per-vertex `aLife` (the arc's remaining life 1→0, same value across the
  arc's vertices).
- **Shader:** color `mix(cOrange, cYellow, aProgress)`; a bright head glow
  travels A→B as life decays: `float head = exp(-abs(aProgress - (1.0 - aLife)) * 5.0);`
  total intensity `(0.35 + head * 2.2) * pow(aLife, 0.6) * 3.0` (HDR — bloom
  catches it); alpha `pow(aLife, 0.6) * (0.25 + head * 0.75)`; additive
  blending, `transparent`, `depthWrite: false`.
- **API:** `mesh: THREE.LineSegments`; `activate(n: number)` — erupts up to
  `n` idle arcs at fresh random positions with life 1 and duration
  `0.5 + Math.random() * 0.3` s; `update(delta: number)` — decays lives,
  rewrites the `aLife` attribute; `dispose()` not needed (geometry/material
  reaped by the scene's dispose traverse since the mesh joins `mainGroup`).

### 2. Scene wiring (`lib/neural/scene.ts`)

- `init()`: `this.flares = new FlareField(CORE_RADIUS, this.uniforms, this.isMobile ? 14 : 28); this.mainGroup.add(this.flares.mesh);`
- `pulse(count)`: after the existing pulseLevel bump —
  `if (!this.reduceMotion) this.flares?.activate(2 + Math.floor(Math.random() * 2));`
  (2–3 arcs per word; none under prefers-reduced-motion — flares are motion).
- `greet()`: `if (!this.reduceMotion) this.flares?.activate(8);` (volley).
- `animate()`: `this.flares?.update(delta);`

### 3. Space backdrop (two new builders in `lib/neural/scene.ts`)

- **`buildStars()`:** one `THREE.Points` of 2500 stars (1200 mobile) at radii
  220–420 (random, for depth), full sphere. Per-star attributes: size
  0.6–2.2, twinkle seed, slight color variation (85% white, 10% cool blue
  `0xbfd4ff`, 5% warm `0xffe0b8`). Custom `ShaderMaterial` (immune to scene
  fog by construction): round point sprite, brightness
  `0.75 + 0.25 * sin(time * (0.5 + seed) + seed * 40.0)` for subtle twinkle;
  additive blending, `depthWrite: false`. Added to `this.scene` directly (NOT
  `mainGroup`) so orbiting feels like moving through a fixed sky.
- **`buildNebula()`:** a `THREE.SphereGeometry(500, 32, 32)` with
  `side: THREE.BackSide` and a `ShaderMaterial` sharing `this.uniforms`:
  2-octave simplex noise (reuse the existing `snoise3GLSL` string) over the
  view direction, drifting very slowly (`time * 0.01`); color
  `cSurface * noise * 0.16` with alpha `noise * 0.14` — a barely-there,
  theme-tinted haze. Additive, `depthWrite: false`, `depthTest: false`,
  `renderOrder = -1` so it always sits behind everything. Added to
  `this.scene`.
- Existing dust field and `FogExp2` stay (fog can't touch either backdrop —
  both use ShaderMaterials, which ignore fog unless explicitly enabled).
- Camera far plane is 1000 — comfortably beyond the 500 shell.

## Error handling

None new — pure GPU content on existing code paths; WebGL-unsupported path
unchanged; everything joins `scene`/`mainGroup` and is reaped by the existing
dispose traverse.

## Testing & verification

1. New unit test for the only pure logic: `FlareField` arc bookkeeping —
   constructing with jsdom-safe stubs isn't feasible (THREE geometry is fine
   in node, no WebGL needed for construction!) so DO test: after
   `activate(3)`, three arcs have life > 0; after `update(1.0)` (a full
   second), all lives are 0 again; `activate` never exceeds the pool.
   (THREE BufferGeometry/Curve math runs headless in vitest — no renderer
   involved.)
2. Full gate clean (tsc, lint, vitest — 56 existing + new flare tests).
3. Manual: stars twinkle subtly and hold still while the scene auto-rotates
   past them; faint nebula tint shifts with themes; speaking erupts visible
   arcs off the core that rise and die per word; greet fires a volley; idle
   scene shows no flares; reduced-motion shows no flares.
