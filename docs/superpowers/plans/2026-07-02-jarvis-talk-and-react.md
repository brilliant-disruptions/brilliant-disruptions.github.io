# Talk to JARVIS (Voice In, Voice Out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tap-to-talk voice interaction to the Neural tab: the user speaks, JARVIS answers aloud from the scripted intent table, and the magma core ripples to the user's voice while listening and swells with JARVIS's reply.

**Architecture:** A new `JarvisListener` class wraps the browser's `SpeechRecognition` in single-utterance mode behind a three-callback API. The page adds a mic button and a small idle/listening state; everything else is reuse — `MicAnalyser` (existing) drives the core during the user's turn, `matchIntent()` (existing) picks the reply, and the page's existing `speak()` envelope animates JARVIS's turn.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript, Web Speech API (SpeechRecognition + existing SpeechSynthesis usage), vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-jarvis-talk-and-react-design.md`

## Global Constraints

- Work happens inside `jarvis-app/`; run all npm commands from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`.
- Voice-only UX: no captions, no transcript UI, no visible error states. Audio cues only (`HudSound.blip()`).
- Replies come ONLY from `matchIntent()` in `lib/neural/intents.ts` — no LLM, no `ai-gateway` calls, no network.
- Recognition is single-utterance: `continuous = false`, `interimResults = false`, `lang = "en-US"`, `maxAlternatives = 1`.
- Files that must NOT change: `lib/neural/scene.ts`, `themes.ts`, `sound.ts`, `mic-analyser.ts`, `intents.ts`, `components/neural/ThemeSwitcher.tsx`, `lib/neural/speech.d.ts` (it already declares everything needed — verified).
- No dependency changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Characterization tests for matchIntent

**Files:**
- Test: `lib/neural/intents.test.ts` (create)

**Interfaces:**
- Consumes: `INTENTS`, `FALLBACK`, `matchIntent(text: string): string` from `lib/neural/intents.ts` (existing, unchanged).
- Produces: nothing consumed by later tasks — this is the safety net under the module Task 3 starts depending on.

Note on TDD: `matchIntent` already exists, so these are characterization tests — they must pass immediately against current behavior. There is no RED phase for existing behavior; the "failure check" step instead verifies the tests are actually wired up (a deliberately broken assertion fails).

- [ ] **Step 1: Write the tests**

Create `lib/neural/intents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FALLBACK, INTENTS, matchIntent } from "./intents";

const responsesOf = (id: string): string[] => {
  const intent = INTENTS.find((i) => i.id === id);
  if (!intent) throw new Error(`no intent ${id}`);
  return Array.isArray(intent.response) ? intent.response : [intent.response];
};

describe("matchIntent", () => {
  it("matches a greeting", () => {
    expect(responsesOf("greeting")).toContain(matchIntent("hey there"));
  });

  it("is case-insensitive", () => {
    expect(matchIntent("WHO ARE YOU?")).toContain("JARVIS");
  });

  it("returns one of the listed responses for multi-response intents", () => {
    expect(responsesOf("joke")).toContain(matchIntent("tell me a joke"));
  });

  it("matches company questions", () => {
    expect(matchIntent("tell me about brilliant disruptions")).toContain("Brilliant Disruptions");
  });

  it("falls back on unrecognized input", () => {
    expect(matchIntent("florble grombit xyzzy")).toBe(FALLBACK);
  });

  it("falls back on empty input", () => {
    expect(matchIntent("")).toBe(FALLBACK);
  });
});
```

- [ ] **Step 2: Verify the tests are wired (deliberate failure)**

Temporarily change the last assertion to `.toBe("nope")` and run:
`npm run test -- lib/neural/intents.test.ts`
Expected: 1 FAIL. Revert the assertion to `.toBe(FALLBACK)`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test -- lib/neural/intents.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add lib/neural/intents.test.ts
git commit -m "$(cat <<'EOF'
Add characterization tests for the JARVIS intent engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: JarvisListener — SpeechRecognition wrapper

**Files:**
- Create: `lib/neural/listen.ts`

**Interfaces:**
- Consumes: ambient `SpeechRecognition` types from `lib/neural/speech.d.ts` (existing — declares `Window.SpeechRecognition?`, `Window.webkitSpeechRecognition?`, `onresult`/`onerror`/`onend`, `abort()`; nothing needs adding).
- Produces: `export type ListenHandlers = { onResult: (transcript: string) => void; onEnd: () => void; onError: (code: string) => void }` and `export class JarvisListener` with `static isSupported(): boolean`, `start(handlers: ListenHandlers): void`, `stop(): void`. Task 3's page calls exactly these.

No unit test: the class is a thin adapter over a browser-only API that jsdom does not implement; behavior contracts (single `onEnd`, transcript extraction) are enforced by the code shape below and exercised in Task 3's manual verification. The gate is the type-check.

- [ ] **Step 1: Create `lib/neural/listen.ts`**

```ts
/**
 * JarvisListener — one tap, at most one transcript.
 *
 * Wraps the browser's SpeechRecognition (including Chrome's webkit-prefixed
 * constructor) in single-utterance mode and de-duplicates its event soup:
 * onResult fires at most once with the top transcript, onEnd fires exactly
 * once when recognition finishes for any reason (result, silence, error,
 * abort). No scene, sound, or intent knowledge — the page composes those.
 * Ambient types live in speech.d.ts.
 */

export type ListenHandlers = {
  onResult: (transcript: string) => void;
  onEnd: () => void;
  onError: (code: string) => void;
};

export class JarvisListener {
  private recognition: SpeechRecognition | null = null;
  private endedNotified = false;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
    );
  }

  /** Start a single-utterance listen. No-op if one is already running. */
  start(handlers: ListenHandlers): void {
    if (this.recognition) return;
    const Ctor =
      typeof window !== "undefined"
        ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
        : undefined;
    if (!Ctor) {
      handlers.onError("unsupported");
      handlers.onEnd();
      return;
    }

    this.endedNotified = false;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    const finish = () => {
      if (this.endedNotified) return;
      this.endedNotified = true;
      this.recognition = null;
      handlers.onEnd();
    };

    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (transcript) handlers.onResult(transcript);
    };
    rec.onerror = (ev) => {
      handlers.onError(ev.error || "unknown");
      finish();
    };
    rec.onend = finish;

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if the engine already has an active session.
      handlers.onError("start-failed");
      finish();
    }
  }

  /** Abort any in-flight recognition; safe to call when idle. */
  stop(): void {
    const rec = this.recognition;
    if (!rec) return;
    try {
      rec.abort(); // fires onend → finish() clears state and notifies
    } catch {
      this.recognition = null;
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/neural/listen.ts
git commit -m "$(cat <<'EOF'
Add JarvisListener speech-recognition wrapper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mic button + interaction wiring on the Neural page

**Files:**
- Modify: `app/(app)/neural/page.tsx`

**Interfaces:**
- Consumes: `JarvisListener` / `ListenHandlers` (Task 2), `matchIntent` from `@/lib/neural/intents`, `MicAnalyser` from `@/lib/neural/mic-analyser` (existing: `start(onLevel: (level: number, peak: boolean) => void): Promise<boolean>`, `stop(): void`), `THEMES` from `@/lib/neural/themes` (for the accent color), plus everything the page already uses.
- Produces: the final page. Nothing downstream.

All edits below are exact chunks against the current file. Apply in order.

- [ ] **Step 1: Add imports**

Replace:

```tsx
import { NeuralScene } from "@/lib/neural/scene";
import { HudSound } from "@/lib/neural/sound";
import { ThemeSwitcher } from "@/components/neural/ThemeSwitcher";
```

with:

```tsx
import { NeuralScene } from "@/lib/neural/scene";
import { HudSound } from "@/lib/neural/sound";
import { JarvisListener } from "@/lib/neural/listen";
import { MicAnalyser } from "@/lib/neural/mic-analyser";
import { matchIntent } from "@/lib/neural/intents";
import { THEMES } from "@/lib/neural/themes";
import { ThemeSwitcher } from "@/components/neural/ThemeSwitcher";
```

- [ ] **Step 2: Add refs and state**

Replace:

```tsx
  const voiceRaf = useRef(0);
  const voiceSpike = useRef(0);

  const [active, setActive] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [theme, setTheme] = useState(0);
```

with:

```tsx
  const voiceRaf = useRef(0);
  const voiceSpike = useRef(0);
  const listenerRef = useRef<JarvisListener | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);

  const [active, setActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [theme, setTheme] = useState(0);
  const [micState, setMicState] = useState<"idle" | "listening">("idle");
  const [micSupported, setMicSupported] = useState(false);
```

- [ ] **Step 3: Create/tear down listener and mic in the lifecycle effect**

Replace:

```tsx
    soundRef.current = new HudSound();
    return () => {
      if (boundaryTimer.current) {
        clearInterval(boundaryTimer.current);
        boundaryTimer.current = null;
      }
      window.speechSynthesis?.cancel();
```

with:

```tsx
    soundRef.current = new HudSound();
    listenerRef.current = new JarvisListener();
    micRef.current = new MicAnalyser();
    setMicSupported(JarvisListener.isSupported());
    return () => {
      listenerRef.current?.stop();
      listenerRef.current = null;
      micRef.current?.stop();
      micRef.current = null;
      if (boundaryTimer.current) {
        clearInterval(boundaryTimer.current);
        boundaryTimer.current = null;
      }
      window.speechSynthesis?.cancel();
```

(`setMicSupported` runs inside the mount effect, so SSR/hydration never sees the button: first client render has `micSupported === false`, matching the server.)

- [ ] **Step 4: Track speaking state in `speak()`**

Replace:

```tsx
    (text: string) => {
      speakingRef.current = true;
      startVoiceEnvelope();
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const done = () => {
        speakingRef.current = false;
        stopBoundaryFallback();
        stopVoiceEnvelope();
      };
```

with:

```tsx
    (text: string) => {
      speakingRef.current = true;
      setSpeaking(true);
      startVoiceEnvelope();
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const done = () => {
        speakingRef.current = false;
        setSpeaking(false);
        stopBoundaryFallback();
        stopVoiceEnvelope();
      };
```

- [ ] **Step 5: Add the mic interaction and guard the greet button**

Replace:

```tsx
  const onGreet = () => {
    if (active) return;
```

with:

```tsx
  const onMic = () => {
    if (active || speaking) return;
    if (micState === "listening") {
      listenerRef.current?.stop(); // onEnd handler below resets state
      return;
    }
    soundRef.current?.unlock(); // mic tap may be the first user gesture
    soundRef.current?.blip();
    unlockSynthesis();
    setMicState("listening");

    // Ripple the core with the user's live voice. If mic-level access is
    // denied this resolves false and we simply listen without the ripple —
    // SpeechRecognition manages its own capture.
    void micRef.current?.start((level, peak) => {
      sceneRef.current?.setVoiceLevel(level * 0.8);
      if (peak) sceneRef.current?.pulse(1);
    });

    listenerRef.current?.start({
      onResult: (transcript) => {
        speak(matchIntent(transcript));
      },
      onEnd: () => {
        micRef.current?.stop();
        sceneRef.current?.setVoiceLevel(0);
        soundRef.current?.blip();
        setMicState("idle");
      },
      onError: () => {
        // Voice-only UX: errors take the quiet path back to idle via onEnd.
      },
    });
  };

  const onGreet = () => {
    if (active || speaking || micState === "listening") return;
```

- [ ] **Step 6: Render the mic button next to the greet button**

Replace:

```tsx
          <div className="absolute left-1/2 -translate-x-1/2">
            <button
              onClick={onGreet}
              disabled={active}
```

with:

```tsx
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
            <button
              onClick={onGreet}
              disabled={active || speaking || micState === "listening"}
```

Then, immediately after the greet `</button>` closing tag (still inside that flex div), insert:

```tsx
            {micSupported && (
              <button
                onClick={onMic}
                disabled={active || speaking}
                aria-label={micState === "listening" ? "Stop listening" : "Talk to JARVIS"}
                title={micState === "listening" ? "Listening… tap to cancel" : "Talk to JARVIS"}
                className="pointer-events-auto grid h-14 w-14 place-items-center backdrop-blur transition disabled:opacity-50"
                style={{
                  clipPath:
                    "polygon(0 10px, 10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px))",
                  background:
                    micState === "listening" ? `${THEMES[theme].accent}22` : "rgba(0,229,255,0.08)",
                  border: `1.5px solid ${micState === "listening" ? THEMES[theme].accent : "var(--cyan)"}`,
                  boxShadow:
                    micState === "listening"
                      ? `0 0 30px ${THEMES[theme].accent}88`
                      : "0 0 18px rgba(0,229,255,0.25)",
                  color: micState === "listening" ? THEMES[theme].accent : "var(--white)",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="9" y="2.5" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <line x1="12" y1="18" x2="12" y2="21.5" />
                </svg>
              </button>
            )}
```

(The `accent` values are 6-digit hex from `THEMES`, so `${accent}22` / `${accent}88` are valid 8-digit hex colors with alpha.)

- [ ] **Step 7: Update the page doc comment**

Replace:

```tsx
/**
 * JARVIS Neural Interface — a member-gated, full-screen magma core.
 *
 * A molten noise-displaced core wrapped in energy veins that pulse inward from
 * an Earth-outline globe (Three.js + bloom + orbit controls). The "Hi, I'm
 * JARVIS" button unlocks audio, fires a power-up cue and speaks a greeting
 * while the core swells with each word. Theme switcher bottom-left.
 */
```

with:

```tsx
/**
 * JARVIS Neural Interface — a member-gated, full-screen magma core.
 *
 * A molten noise-displaced core wrapped in energy veins that pulse inward from
 * an Earth-outline globe (Three.js + bloom + orbit controls). The "Hi, I'm
 * JARVIS" button speaks a greeting; the mic button listens (tap-to-talk,
 * scripted-intent replies) — the core ripples with the user's voice while
 * listening and swells with JARVIS's words while he speaks. Voice-only: no
 * captions. Theme switcher bottom-left.
 */
```

- [ ] **Step 8: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all pass, pristine output (test count now 53: 47 existing + 6 from Task 1).

- [ ] **Step 9: Manual verification on the dev server (Chrome)**

With `npm run dev` running, at `http://localhost:3000/neural` (authenticated):

1. Mic button renders next to "Hi, I'm JARVIS" with a mic glyph.
2. Tap mic → blip, button glows in the active theme's accent; speak "who are you" → the core ripples while you talk; on finishing, a blip, then JARVIS answers aloud and the core swells per word.
3. "tell me a joke" → one of the scripted jokes; gibberish → the fallback line.
4. Tap mic then tap again before speaking → cancels quietly back to idle.
5. While JARVIS is speaking, both buttons are disabled; while listening, the greet button is disabled.
6. Deny mic permission (site settings) → recognition may still work via the recognition engine's own prompt path, or ends quietly; either way no error UI and the page stays functional.
7. Switch theme, then listen again → the mic glow uses the new accent.
8. Leave the tab mid-listen (← CONSOLE) → recording indicator disappears; no console errors on return.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/neural/page.tsx"
git commit -m "$(cat <<'EOF'
Add tap-to-talk voice interaction to the Neural page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
