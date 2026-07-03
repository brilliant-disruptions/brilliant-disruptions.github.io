# Neural Tab — Theatrical Voice Drama

**Date:** 2026-07-03
**Status:** Approved
**Target:** `jarvis-app` — `lib/neural/scene.ts` only

## Goal

The core's reaction while JARVIS speaks is too subtle. User chose "Theatrical":
the core swells ~2× more than now, each word kicks a visible surge down the
veins that lingers ~half a second, and the scene's bloom brightens with his
voice. No camera motion (explicitly not the "Max drama + camera" option).

## Design — exact value changes in `lib/neural/scene.ts`

All existing wiring stays (page envelope, uVoice/uPulse uniforms, greet surge);
only these constants change:

| Where | From | To | Effect |
|---|---|---|---|
| Core vertex shader `amp` | `0.15 + uVoice * 0.30` | `0.15 + uVoice * 0.60` | ~2× voice swell |
| Core fragment glow | `1.5 + uVoice * 0.9 + uPulse * 0.4` | `1.5 + uVoice * 1.8 + uPulse * 0.8` | core visibly brightens per word |
| Vein pulse glow | `pulse * (10.0 + uPulse * 18.0)` | `pulse * (10.0 + uPulse * 30.0)` | word surges pop on the veins |
| Vein pulse alpha | `pulse * (0.9 + uPulse * 0.5)` | `pulse * (0.9 + uPulse * 0.9)` | surges more opaque |
| `animate()` pulse decay | `Math.exp(-6 * delta)` | `Math.exp(-3.5 * delta)` | word kicks linger ~0.5 s |
| `pulse(count)` punch | `+ 0.2 * count` | `+ 0.3 * count` | stronger per-word kick |
| `animate()` bloom | `2.0 + this.greetLevel * 1.2` | `2.0 + this.greetLevel * 1.2 + this.uniforms.uVoice.value * 0.9` | whole scene glows with his voice |

`prefers-reduced-motion` note: the existing reduced-motion guard only disables
auto-rotate; voice glow (color/brightness, not motion) intentionally stays, and
the larger vertex swell is voice-gated and brief — acceptable per the earlier
reduced-motion decision (color/glow response stays on).

## Testing & verification

1. Full gate clean (`tsc`, lint, 56 vitest tests — no test changes; values are
   shader/scene constants).
2. Manual: greeting speech makes the core unmistakably surge per word, vein
   pulses flare and linger briefly, bloom breathes with the voice; idle scene
   (no speech) looks unchanged from before.

## Tuning addendum (2026-07-03)

User reviewed Theatrical live and asked for "a little more dramatic." All seven
values raised one notch: swell 0.60→0.85, core glow 1.8/0.8→2.6/1.2, vein glow
30→42, vein alpha 0.9→1.3, decay −3.5→−2.8, word punch 0.3→0.4, bloom 0.9→1.4.
