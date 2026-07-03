# Neural Tab — Rotating Greetings, Speech Robustness, Scene Trim

**Date:** 2026-07-02
**Status:** Approved
**Target:** `jarvis-app` — the `/neural` tab (builds on the magma-core and talk-to-JARVIS specs of the same date)

## Goal

Three user-confirmed changes:

1. **Fix the silent-speech wedge.** On the user's devices, speech synthesis
   silently fails: clicking "Hi, I'm JARVIS" flips the button and plays the
   power-up cue, but no voice — and because the utterance never starts,
   `speaking` never resets, permanently disabling both buttons until refresh.
2. **Rotating greetings.** The button should cycle through ~8 greetings
   (shuffle-bag, no repeats within a cycle, no back-to-back repeat across
   cycles), including exactly: `Hi Jimmy, I love that for you.`
3. **Remove the world map.** Drop the Earth-outline globe shell AND the
   volcano dots (user chose "outlines + volcano dots"). Core, veins, dust,
   fog, themes, and voice reactivity stay.

Voice input (mic tap-to-talk) is parked per the user — no changes to it beyond
what fix 1 inherently repairs (a wedged `speaking` flag also disabled the mic).

## Design

### 1. Speech robustness (`app/(app)/neural/page.tsx`, inside `speak()`)

- **Start watchdog:** after `synth.speak(u)`, set a ~1200 ms timer. If
  `onstart` has not fired by then (engine swallowed the utterance — a known
  Chrome/iOS behavior, commonly triggered by `cancel()` immediately before
  `speak()`), start the existing boundary-fallback visuals so the core still
  performs, and let the failsafe below end the turn. The watchdog is cleared
  by `onstart`/`onend`/`onerror`.
- **Conditional cancel:** replace the unconditional `synth.cancel()` before
  speaking with `if (synth.speaking || synth.pending) synth.cancel();`.
- **Failsafe end:** every `speak()` schedules a hard `done()` at estimated
  duration + margin (`Math.max(4000, (text.length / 10) * 1000 + 2000)` ms),
  cleared when `onend`/`onerror` arrive first. `done()` stays idempotent (it
  already is safe to call twice; guard so state isn't reset mid-next-speak:
  the failsafe timer is cleared at the start of any new `speak()`).
- All timers live in refs and are cleared on unmount.

### 2. Rotating greetings (`lib/neural/greetings.ts`, new)

- `export const GREETINGS: string[]` — exactly these 8 lines:
  1. `Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.`
  2. `Hi Jimmy, I love that for you.`
  3. `Good evening. Systems are nominal, egos are inflated.`
  4. `You rang? Of course you did.`
  5. `JARVIS online. Try not to break anything expensive.`
  6. `All synapses firing. Well — most of them.`
  7. `Welcome back. The magma's warm, the veins are humming.`
  8. `At your service. As always. Forever. No pressure.`
- `export function createGreetingBag(): () => string` — returns a draw
  function implementing a shuffle bag: shuffles a copy of `GREETINGS`, deals
  one per call, reshuffles when empty, and if the reshuffled bag would start
  with the previously dealt line, swaps it deeper so no greeting ever plays
  twice in a row. Pure module (uses `Math.random`), unit-testable by
  injecting nothing — tests assert set-coverage per cycle and no immediate
  repeats over many draws.
- The page holds one bag in a ref; `onGreet` speaks `bag()` instead of the
  single `GREETING` constant (which is deleted).

### 3. Scene trim (`lib/neural/scene.ts`, `lib/neural/themes.ts`, tests, asset)

- `scene.ts`: delete `buildGlobe()`, `buildVolcanoes()`, the `volcanoMat`
  field, the `earthTex` field + `TextureLoader` call + its dispose line, and
  the `tEarth`/`boundaryColor` uniforms; remove the volcano/boundary lerp
  lines from `animate()`.
- `themes.ts`: remove `boundary` and `volcano` from `NeuralTheme` and all
  three palettes; `themes.test.ts` updated to stop asserting them.
- Delete `public/textures/earth_specular_2048.jpg`.
- Everything else (core, veins, dust, fog, bloom, controls, voice
  reactivity, `setTheme`) unchanged.

## Error handling

- Speech engine mute/broken → visuals still perform (fallback pulses), turn
  ends by failsafe, buttons re-enable. No visible error (voice-only UX).
- Rapid re-click during the active window stays blocked by `active`/
  `speaking` as today — but neither flag can now stick.

## Testing & verification

1. New unit tests for `createGreetingBag`: every `GREETINGS.length` draws
   cover the full set exactly once; across 200 draws no two consecutive
   draws are equal; all draws are members of `GREETINGS`.
2. Existing `themes.test.ts` updated (no `boundary`/`volcano`); full gate
   (`tsc`, lint, vitest) clean.
3. Manual: repeated clicks cycle different greetings (or, on a mute-TTS
   device, different-length visual performances) and the buttons always
   re-enable; scene shows no continent outlines or throbbing dots; themes
   still cross-fade core/veins/dust/fog.
