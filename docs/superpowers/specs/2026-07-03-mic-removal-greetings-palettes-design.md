# Neural Tab — Mic Removal, Greeting Copy, Palette Overhaul

**Date:** 2026-07-03
**Status:** Approved
**Target:** `jarvis-app` — `/neural` page, greetings data, theme palettes

## Goal (user-confirmed)

1. **Remove the mic button "for now".** The tap-to-talk UI leaves the page;
   the voice modules (`listen.ts`, `mic-analyser.ts`, `intents.ts` + tests)
   stay in the repo, tested, for a future return.
2. **Apply the new greeting set** — 8 dry-butler, Iron-Man-flavored original
   lines (approved verbatim below).
3. **Palettes: drop pink "Neon Void"; add three new palettes** (5 total):
   Hot Rod & Gold (Iron Man armor), Arc Reactor, Falcon (SpaceX).

## Design

### 1. Mic removal (`app/(app)/neural/page.tsx` only)

Remove: the `JarvisListener`/`MicAnalyser`/`matchIntent` imports; the
`listenerRef`, `micRef`, `listenSession` refs; `micState`/`micSupported`
state; the lifecycle effect's listener/mic creation and their cleanup lines
(the `listenSession.current++` + eslint-disable pair goes too — it existed for
the mic session); the entire `onMic` handler; the mic `<button>` JSX (and the
now-unneeded flex wrapper stays harmless — keep the wrapper, drop the button);
the `micState === "listening"` term in `onGreet`'s guard and the greet
button's `disabled` prop. Also remove `unlockSynthesis` and
`synthUnlockedRef` — `onMic` was their last caller (the greeting speaks
synchronously inside the click gesture and needs no separate unlock).

Keep: `speakSession` (guards speak-turn callbacks — unrelated to mic), all
speech synthesis code, the greet flow, ThemeSwitcher.

Files NOT touched: `lib/neural/listen.ts`, `mic-analyser.ts`, `intents.ts`
and their tests — they stay green in the suite.

### 2. Greetings (`lib/neural/greetings.ts`)

`GREETINGS` becomes exactly (order below; shuffle bag unchanged):

1. `Hi Jimmy, I love that for you.`
2. `Good evening, sir. The suit is in the wash — this hologram will have to do.`
3. `Systems online. Sarcasm calibrated to factory settings.`
4. `Welcome back. I've taken the liberty of judging your browser history.`
5. `All systems operational. Unlike your sleep schedule.`
6. `At your service, sir. Reluctantly. But at your service.`
7. `Online. Shall I save the world today, or just the quarterly forecast?`
8. `Diagnostics complete: charm at one hundred percent. Humility... not found.`

Still 8 unique lines — the existing tests (length 8, Jimmy verbatim,
uniqueness, shuffle behavior) pass unchanged.

### 3. Palettes (`lib/neural/themes.ts`, `themes.test.ts`)

Remove "Neon Void". Final `THEMES` order and values ("Magma & Cyan" and
"Solar Flare" unchanged):

1. **Magma & Cyan** (existing, unchanged)
2. **Hot Rod & Gold** — Iron Man armor
   - swatch `linear-gradient(135deg, #b3001b, #ffcf40)`, accent `#ffcf40`
   - core: `(0.08, 0.0, 0.01)`, `(0.75, 0.02, 0.05)`, `(1.0, 0.25, 0.05)`, `(1.0, 0.8, 0.25)`
   - vein: surface `(0.55, 0.85, 1.0)` (arc-reactor blue-white), coreA `(0.9, 0.1, 0.05)`, coreB `(1.0, 0.75, 0.2)`
   - dust `0x332211`, bg `0x050102`
3. **Arc Reactor** — the reactor glow
   - swatch `linear-gradient(135deg, #0a2f66, #cfeaff)`, accent `#7fd4ff`
   - core: `(0.0, 0.02, 0.08)`, `(0.05, 0.25, 0.8)`, `(0.3, 0.7, 1.0)`, `(1.3, 1.4, 1.5)`
   - vein: surface `(1.0, 0.85, 0.45)` (pale gold), coreA `(0.1, 0.5, 1.0)`, coreB `(0.6, 0.9, 1.0)`
   - dust `0x112a44`, bg `0x000208`
4. **Falcon** — SpaceX monochrome
   - swatch `linear-gradient(135deg, #1b2735, #e8eef5)`, accent `#c9d4e0`
   - core: `(0.02, 0.03, 0.05)`, `(0.35, 0.4, 0.5)`, `(0.8, 0.85, 0.95)`, `(1.4, 1.4, 1.5)`
   - vein: surface `(0.85, 0.92, 1.0)` (cool white), coreA `(0.5, 0.6, 0.75)`, coreB `(1.0, 1.0, 1.0)`
   - dust `0x2a3340`, bg `0x02040a`
5. **Solar Flare** (existing, unchanged)

`themes.test.ts`: expected length 3 → 5; expected names updated to the order
above. Everything downstream (scene lerp, ThemeSwitcher, nebula/flare tint,
mic-glow — now gone) consumes `THEMES` generically, so no other code changes.
The switcher pill simply shows 5 swatches. `setTheme` clamps to
`THEMES.length - 1` already.

Color values are a starting point — the user judges them live and we tune by
eye afterward if wanted.

## Error handling

None new. Page state machine shrinks (idle/greeting only).

## Testing & verification

1. Full gate: `tsc`, lint, vitest — same 61 tests, all green (greetings and
   themes tests updated in place; voice-module tests untouched and still run).
2. Manual: no mic button; greet still speaks/performs; 5 swatches cycle all
   palettes across core, veins, dust, fog, nebula, flares; the two new-style
   greetings sets rotate correctly.
