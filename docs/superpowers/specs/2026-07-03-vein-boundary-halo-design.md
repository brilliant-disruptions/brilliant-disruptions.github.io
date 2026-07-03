# Neural Tab — Vein Boundary Halo

**Date:** 2026-07-03
**Status:** Approved
**Target:** `jarvis-app` — the `/neural` tab scene (follows the 2026-07-02 scene-trim spec)

## Goal

After removing the Earth-outline globe, the energy veins appear to spawn from
empty space. Add a **soft glow halo** — a fresnel-rim sphere at the vein-origin
radius — so the veins visibly emerge from a spherical energy field. User chose
this over a wireframe cage or particle shell.

## Design

One new private builder in `lib/neural/scene.ts`, called from `init()` after
`buildVeins()`:

- `buildHalo()`: `THREE.SphereGeometry(OUTER_RADIUS * 0.995, 64, 64)` with a
  `ShaderMaterial` sharing `this.uniforms`:
  - Vertex: pass view-space normal (`normalize(normalMatrix * normal)`).
  - Fragment: fresnel rim `pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.5)`;
    color `cSurface * fresnel * 1.6`; alpha `fresnel * 0.35`. Face-on the
    sphere is invisible; the limb glows softly.
  - `transparent: true`, `blending: THREE.AdditiveBlending`, `depthWrite: false`,
    `side: THREE.BackSide` is NOT used — front side only (rim reads correctly
    from outside; camera minDistance 12 > radius 10 keeps us outside).
- Color comes from the existing `cSurface` uniform (vein origin color), so the
  halo cross-fades with theme switches automatically. No new uniforms, no new
  theme fields, no `animate()` changes.
- Added to `mainGroup`; disposed by the existing traverse in `dispose()`.

## Non-goals

No wireframe, no particles, no new theme channels, no changes outside
`scene.ts`.

## Error handling

None new — pure GPU material; the existing WebGL-unsupported path is untouched.

## Testing & verification

1. Full gate (`npx tsc --noEmit`, `npm run lint`, `npm run test` — 56 tests) clean.
2. Manual: a soft rim of light at the sphere edge where veins spawn, invisible
   at the sphere's center; recolors with all three themes; no z-fighting with
   vein starts; scene still calm when idle.
