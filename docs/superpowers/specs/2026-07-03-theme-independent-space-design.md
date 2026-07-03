# Neural Tab — Theme-Independent Space

**Date:** 2026-07-03
**Status:** Approved
**Target:** `jarvis-app` — scene background/nebula, theme data

## Goal (user-confirmed)

Theme switches must not recolor space. The background (fog/clear color) becomes
a single fixed deep-space color, and the nebula's haze gets a fixed subtle
indigo instead of the theme's vein color. Themes keep re-tinting the machine:
core, veins, halo, flares, and dust (dust deliberately stays themed — it reads
as part of the scene, not the sky). Stars were already theme-independent.

## Design

- `lib/neural/scene.ts`:
  - New module constant `SPACE_BG = 0x01030a` beside the other scene constants.
  - `init()`: fog constructed with `SPACE_BG` instead of `THEMES[0].bg.getHex()`.
  - `animate()`: delete the two per-frame background lines (fog-color lerp to
    `tgt.bg` and the `setClearColor` refresh) — the clear color set once in
    `init()` never changes.
  - Nebula fragment shader: drop the `cSurface` uniform declaration; haze color
    becomes fixed `vec3(0.35, 0.45, 0.85)` at the same `* n * 0.16` gain.
- `lib/neural/themes.ts`: remove `bg: Color` from `NeuralTheme` and the `bg:`
  line from all five palettes; drop "fog/background" from the doc comment.
- `lib/neural/themes.test.ts`: remove the `t.bg` assertion.

## Testing & verification

Full gate clean (tsc, lint, 61 tests). Manual: switching all five themes leaves
the background and nebula visually identical; core/veins/halo/flares/dust still
cross-fade.
