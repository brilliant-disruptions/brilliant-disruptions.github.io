# Neural Tab — Magma Core Visualization

**Date:** 2026-07-02
**Status:** Approved
**Target:** `jarvis-app` — the `/neural` tab

## Goal

Replace the Neural tab's arc-reactor scene with the "magma core" Three.js
visualization (from https://codepen.io/VoXelo/pen/RNGRQBo): a molten noise-displaced
core sphere, ~1200 energy veins pulsing inward from an Earth-outline globe shell,
volcano points, a dust field, and bloom post-processing — with orbit controls and a
three-palette theme switcher. Keep JARVIS's voice greeting and make the new core
visibly react to his speech.

## Scope decisions (user-confirmed)

- **Target surface:** the `Neural` tab in `jarvis-app` (`app/(app)/neural/page.tsx`),
  not the static `jarvis.html` or `projects/jarvis/` pages.
- **Chrome level:** "CodePen + minimal chrome" — the visualization with orbit
  controls and theme switcher, plus a back-to-console link and the
  "Hi, I'm JARVIS" voice button. The ENGAGE gate, boot sequence, HUD rings,
  HUD panels, scanlines, and gold frame are removed.
- **Voice sync:** yes — the core ripples with JARVIS's voice as the current scene does.
- **Approach:** rewrite `lib/neural/scene.ts` in place, keeping its public API.
  No parallel old scene, no raw-script embed.
- **ENGAGE gate dropped:** the greet button itself provides the user gesture that
  unlocks audio.
- **Earth texture bundled locally** at `public/textures/earth_specular_2048.jpg`
  (currently hotlinked from raw.githubusercontent.com in the pen).

## Architecture

### `lib/neural/scene.ts` — rewritten `NeuralScene`

A class owning the renderer, camera, `EffectComposer` + `UnrealBloomPass`
(strength 2.0, radius 0.5, threshold 0.85), and `OrbitControls` (damping 0.05,
auto-rotate 0.8, distance clamped 12–50). Uses the app's existing
`three@0.158` (all needed addons exist in that version).

Scene contents, ported from the pen:

| Element | Detail |
|---|---|
| Molten core | Sphere r=2.2, simplex-noise vertex displacement + 4-color noise-banded fragment shader, fresnel rim |
| Veins | 1200 quadratic bezier curves from outer shell (r=10) to core, `LineSegments` with traveling-pulse shader, additive blending |
| Earth globe | Sphere r≈9.95, edge-detection shader over the specular map producing glowing continent outlines + fresnel |
| Volcanoes | 150 throbbing shader points on the outer shell |
| Dust | 2000-point additive particle field, slow rotation |
| Atmosphere | `FogExp2` matched to the theme background; clear color follows fog |

Public API (kept from current scene, so page wiring survives):

- `init(): boolean` — false when WebGL is unavailable (page shows fallback gradient)
- `dispose()` — tears down renderer, geometries, materials, controls, texture
- `setVoiceLevel(level: number)` — 0–1 voice envelope
- `pulse(strength?: number)` — per-word punch
- `greet()` — stronger surge for the greeting
- **New:** `setTheme(index: number)` — sets the lerp target palette

### Voice reactivity

- A `voiceLevel` uniform feeds the core shader: scales vertex displacement from
  the pen's base 0.15 up to ~0.45 and adds a glow boost, so the core swells
  word by word.
- `pulse()` briefly brightens the traveling vein pulse heads;
  `greet()` fires a stronger, longer version of the same surge.
- Decay back to baseline happens inside the scene's render loop; the page's
  existing voice-envelope code (`startVoiceEnvelope`, boundary fallback) is unchanged.

### Themes

The pen's three palettes (Magma & Cyan, Neon Void, Solar Flare) live in the scene
module as lerp targets for core colors, vein colors, boundary color, volcano color,
dust color, fog/background. Colors converge at lerp speed 0.05 per frame.

`components/neural/ThemeSwitcher.tsx` (new): bottom-left glass pill with rotating
conic-gradient border and three gradient swatches, rebuilt as React + the pen's CSS.
Active theme index is page state; changing it calls `scene.setTheme(i)` and updates
the `--theme-color` CSS variable for the border glow.

### `app/(app)/neural/page.tsx` — simplified

Removed: `Phase` state machine, ENGAGE gate, `BootSequence`, `HudRings`,
`HudPanels`, scanline veil, gold frame, ambient/boot sounds.

Kept: canvas + scene lifecycle, all speech-synthesis code (voice picking,
utterance boundary events, envelope, fallback timer), WebGL fallback gradient,
"← CONSOLE" link (top-left), "Hi, I'm JARVIS" button (bottom-center, unchanged
styling, still triggers `HudSound.powerUp()` and remains the audio-unlock gesture).

Canvas must stay interactive for orbit controls: overlay elements are
`pointer-events: none` except the link, greet button, and theme switcher.

### Deletions

- `components/neural/BootSequence.tsx`
- `components/neural/HudPanels.tsx`
- `components/neural/HudRings.tsx`
- `HudSound` slims to unlock + `powerUp()` usage from the page (boot/ambient calls
  removed from the page; unused methods may remain in `sound.ts`)
- `lib/neural/mic-analyser.ts` and `lib/neural/intents.ts` are untouched
  (not used by this page today)

## Error handling

- WebGL unavailable → `init()` returns false, page renders the existing static
  gradient fallback; greet button still speaks.
- Earth texture load failure → globe shell simply renders dark (shader outputs ~0);
  no crash. Texture is bundled locally to make this unlikely.
- Speech synthesis unavailable → existing fallback timer path (unchanged) still
  animates the scene via `pulse()`.

## Testing & verification

1. `npm run lint` and `npm run test` in `jarvis-app` (existing vitest suite must pass).
2. Manual on dev server (`/neural`): scene renders with bloom; orbit drag,
   zoom, and auto-rotate work; theme swatches cross-fade all palette channels;
   greet button speaks and the core visibly ripples per word; ← CONSOLE returns
   to `/overview`; page unmount doesn't leak (no WebGL context warnings on
   repeated tab entry/exit).
