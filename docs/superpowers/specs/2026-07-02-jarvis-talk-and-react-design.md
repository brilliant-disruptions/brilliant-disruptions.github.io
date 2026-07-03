# Neural Tab — Talk to JARVIS (Voice In, Voice Out)

**Date:** 2026-07-02
**Status:** Approved
**Target:** `jarvis-app` — the `/neural` tab (builds on the magma-core rewrite, spec 2026-07-02-neural-magma-core-design.md)

## Goal

Let a member talk to JARVIS on the Neural tab: tap a mic button, speak, and JARVIS
answers aloud — with the magma core rippling to the user's live voice while
listening and swelling with JARVIS's words while he replies. No captions, no
transcript UI: the exchange is voice-only.

## Scope decisions (user-confirmed)

- **Brain: scripted only.** Replies come from the existing intent table
  (`lib/neural/intents.ts` — `matchIntent()`); no LLM call, no `ai-gateway` usage.
- **Mic model: tap to talk.** One tap starts a single-utterance listen that
  auto-stops when the phrase ends. No continuous listening, no wake word,
  no text input.
- **Voice only.** No on-screen transcript or captions. Audio cues
  (`HudSound.blip()`) mark listening start/stop.

## Architecture

### `lib/neural/listen.ts` — new `JarvisListener`

A small class wrapping the browser's `SpeechRecognition`
(`window.SpeechRecognition ?? window.webkitSpeechRecognition`; ambient types
exist in `lib/neural/speech.d.ts` — extend that file only if a needed
declaration is missing).

API:

- `static isSupported(): boolean` — true when a SpeechRecognition constructor exists.
- `start(handlers: { onResult(transcript: string): void; onEnd(): void; onError(code: string): void }): void`
  — creates a recognizer with `continuous = false`, `interimResults = false`,
  `lang = "en-US"`, `maxAlternatives = 1`, and starts it. `onResult` fires with
  the top transcript; `onEnd` fires exactly once when recognition finishes for
  any reason (result, no-speech, error, abort) — the class de-duplicates the
  underlying event soup so the page's state machine stays simple.
- `stop(): void` — aborts any in-flight recognition; safe to call when idle.

One clear responsibility: turn one tap into at most one transcript callback.
No scene, sound, or intent knowledge.

### `app/(app)/neural/page.tsx` — mic button + interaction state

New page state: `micState: "idle" | "listening"` plus the existing `active`
(greeting) and speaking flow.

- **Mic button:** rendered next to the "Hi, I'm JARVIS" button in the footer
  center cluster, same clip-path visual language, sized as a compact square/round
  companion. Rendered ONLY when `JarvisListener.isSupported()` (feature-detected
  once on mount into state — SSR-safe). While listening it glows with the active
  theme's `accent` color (reuse the `--theme-color` variable).
- **Tap (idle → listening):** `HudSound.unlock()` (mic tap may be the first
  gesture), `blip()`, `listener.start(...)`, and `MicAnalyser.start(onLevel)` —
  `onLevel(level, peak)` drives `scene.setVoiceLevel(level * 0.8)` and, on
  `peak`, `scene.pulse(1)`, so the core visibly ripples with the user's voice.
  If `MicAnalyser.start()` resolves false (mic level access denied), listening
  continues anyway — SpeechRecognition manages its own capture; the core simply
  doesn't ripple during the user's turn.
- **Tap again while listening:** cancels (`listener.stop()`), returns to idle.
- **On result:** `matchIntent(transcript)` → reply spoken via the existing
  `speak()` (which already runs the voice envelope + word-boundary pulses, so
  the core reacts to JARVIS's reply with zero new wiring).
- **On end (always):** `MicAnalyser.stop()`, `scene.setVoiceLevel(0)`, `blip()`,
  state → idle. Errors (`no-speech`, `not-allowed`, network) take the same quiet
  path — no error UI, per voice-only.
- **Mutual exclusion:** the mic button is disabled while the greeting is
  `active` or JARVIS is speaking; the greet button is disabled while
  `micState === "listening"` or JARVIS is speaking. JARVIS never talks over
  himself or the user. (This adds a `speaking` boolean back to page state —
  reintroduced deliberately, now that two controls need it.)
- **Unmount cleanup:** existing cleanup extends with `listener.stop()` and
  `MicAnalyser.stop()`.

### Unchanged

- `lib/neural/scene.ts`, `themes.ts`, `ThemeSwitcher.tsx`, `sound.ts`,
  `mic-analyser.ts`, `intents.ts` (consumed as-is), `ai-gateway` (not used).
- The greeting button's behavior.

## Error handling

- SpeechRecognition unsupported (Firefox, some Safari) → mic button never
  renders; page works exactly as today.
- Recognition error or silence → soft blip, return to idle; no visible error.
- Mic loudness tap (getUserMedia) denied → recognition still works; no ripple
  during the user's turn.
- Speech synthesis unavailable → `speak()`'s existing fallback timer still
  animates the scene; the reply is silent (pre-existing behavior).
- Unmount mid-listen or mid-reply → recognition aborted, mic stopped, speech
  cancelled (existing), no leaked rAF/intervals/streams.

## Testing & verification

1. New unit tests for `lib/neural/intents.ts` (`matchIntent`): a hit for each of
   several intents (greeting, identity, joke), case-insensitivity, the fallback
   for gibberish, and array responses returning one of the listed strings.
2. `npx tsc --noEmit`, `npm run lint`, `npm run test` all clean in `jarvis-app`.
3. Manual on dev server (`/neural`, Chrome): tap mic → blip + glow; speak
   "who are you" → core ripples while talking; JARVIS answers aloud with the
   core swelling per word; tap-to-cancel works; greet and mic buttons disable
   each other; Firefox (or DevTools with SpeechRecognition removed) shows no
   mic button; leaving the tab mid-listen kills the mic (no recording
   indicator left in the tab strip).
