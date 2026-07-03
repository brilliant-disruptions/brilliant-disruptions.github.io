# Rotating Greetings, Speech Robustness, Scene Trim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JARVIS greet button cycle through 8 shuffled greetings, make speech synthesis failure unable to wedge the UI, and remove the Earth-outline globe + volcano dots from the scene.

**Architecture:** A new pure `greetings.ts` module (shuffle-bag dealer, TDD'd) feeds the page's existing `speak()`. `speak()` itself gains a start-watchdog and a failsafe end timer so `speaking` always resets even when the TTS engine silently swallows an utterance. The scene trim is pure deletion in `scene.ts`/`themes.ts` plus the bundled texture.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript, Web Speech API, three@0.158, vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-jarvis-greetings-and-scene-trim-design.md`

## Global Constraints

- Work happens inside `jarvis-app/`; run all npm commands from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`.
- The Jimmy greeting is copied EXACTLY: `Hi Jimmy, I love that for you.`
- Greeting rotation: shuffle bag — every line once per cycle, reshuffle when empty, never the same line twice in a row (including across the reshuffle boundary).
- Watchdog delay 1200 ms; failsafe delay `Math.max(4000, (text.length / 10) * 1000 + 2000)` ms.
- `synth.cancel()` is called only when `synth.speaking || synth.pending`.
- Scene trim removes: `buildGlobe()`, `buildVolcanoes()`, `volcanoMat`, `earthTex` + its loader + dispose, `tEarth` + `boundaryColor` uniforms, their `animate()` lerp lines, `boundary`/`volcano` theme fields, and `public/textures/earth_specular_2048.jpg`. Core, veins, dust, fog, bloom, controls, themes, voice reactivity stay.
- Mic/tap-to-talk code is untouched (parked by the user).
- No dependency changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Greetings shuffle-bag module

**Files:**
- Create: `lib/neural/greetings.ts`
- Test: `lib/neural/greetings.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `export const GREETINGS: string[]` (8 lines) and `export function createGreetingBag(): () => string`. Task 2's page calls `createGreetingBag()` once and the returned draw function per click.

- [ ] **Step 1: Write the failing test**

Create `lib/neural/greetings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GREETINGS, createGreetingBag } from "./greetings";

describe("GREETINGS", () => {
  it("has 8 lines including the Jimmy greeting verbatim", () => {
    expect(GREETINGS).toHaveLength(8);
    expect(GREETINGS).toContain("Hi Jimmy, I love that for you.");
  });
});

describe("createGreetingBag", () => {
  it("deals every greeting exactly once per cycle", () => {
    const draw = createGreetingBag();
    const cycle = Array.from({ length: GREETINGS.length }, () => draw());
    expect([...cycle].sort()).toEqual([...GREETINGS].sort());
  });

  it("never deals the same greeting twice in a row across 200 draws", () => {
    const draw = createGreetingBag();
    let prev = draw();
    for (let i = 0; i < 200; i++) {
      const next = draw();
      expect(next).not.toBe(prev);
      expect(GREETINGS).toContain(next);
      prev = next;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/neural/greetings.test.ts`
Expected: FAIL — cannot resolve `./greetings`.

- [ ] **Step 3: Write the module**

Create `lib/neural/greetings.ts`:

```ts
/**
 * Greeting lines for the "Hi, I'm JARVIS" button, plus a shuffle-bag dealer:
 * every line plays once per cycle, in random order, and no line ever plays
 * twice in a row — even across a reshuffle boundary.
 */

export const GREETINGS: string[] = [
  "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.",
  "Hi Jimmy, I love that for you.",
  "Good evening. Systems are nominal, egos are inflated.",
  "You rang? Of course you did.",
  "JARVIS online. Try not to break anything expensive.",
  "All synapses firing. Well — most of them.",
  "Welcome back. The magma's warm, the veins are humming.",
  "At your service. As always. Forever. No pressure.",
];

function shuffled(list: string[]): string[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Returns a draw function dealing GREETINGS as a shuffle bag. */
export function createGreetingBag(): () => string {
  let bag: string[] = [];
  let last: string | null = null;
  return () => {
    if (bag.length === 0) {
      bag = shuffled(GREETINGS);
      // Deals come off the END of the bag; if the first deal of the new
      // cycle would repeat the previous line, swap it deeper into the bag.
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        const j = Math.floor(Math.random() * (bag.length - 1));
        [bag[bag.length - 1], bag[j]] = [bag[j], bag[bag.length - 1]];
      }
    }
    last = bag.pop()!;
    return last;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/neural/greetings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/neural/greetings.ts lib/neural/greetings.test.ts
git commit -m "$(cat <<'EOF'
Add greeting shuffle bag for the JARVIS button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Speech robustness + greeting rotation on the page

**Files:**
- Modify: `app/(app)/neural/page.tsx`

**Interfaces:**
- Consumes: `createGreetingBag` from `@/lib/neural/greetings` (Task 1). Everything else already exists in the file.
- Produces: the final page behavior; nothing downstream.

All edits are exact chunks against the current file. Apply in order.

- [ ] **Step 1: Swap the GREETING constant for the greetings import**

Replace:

```tsx
import { matchIntent } from "@/lib/neural/intents";
```

with:

```tsx
import { matchIntent } from "@/lib/neural/intents";
import { createGreetingBag } from "@/lib/neural/greetings";
```

Then DELETE this line entirely:

```tsx
const GREETING = "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.";
```

- [ ] **Step 2: Add timer + bag refs**

Replace:

```tsx
  const listenerRef = useRef<JarvisListener | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);
  const listenSession = useRef(0);
```

with:

```tsx
  const listenerRef = useRef<JarvisListener | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);
  const listenSession = useRef(0);
  const startWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingBag = useRef<(() => string) | null>(null);
```

- [ ] **Step 3: Clear the new timers on unmount**

Replace:

```tsx
      window.speechSynthesis?.cancel();
      if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
```

with:

```tsx
      window.speechSynthesis?.cancel();
      if (startWatchdog.current) clearTimeout(startWatchdog.current);
      if (failsafeTimer.current) clearTimeout(failsafeTimer.current);
      if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
```

- [ ] **Step 4: Replace `speak()` with the watchdog + failsafe version**

Replace the entire current `speak` callback:

```tsx
  const speak = useCallback(
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
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        startBoundaryFallback(text);
        setTimeout(done, Math.max(1500, (text.length / 12) * 1000));
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Light touch: neural voices sound most human near their natural pitch, so
      // we only nudge slightly for a calm, measured delivery.
      u.rate = 0.97;
      u.pitch = 0.96;
      u.lang = "en-GB";
      if (!voiceRef.current) voiceRef.current = pickVoice();
      if (voiceRef.current) u.voice = voiceRef.current;

      let gotBoundary = false;
      u.onstart = () => {
        setTimeout(() => {
          if (!gotBoundary && speakingRef.current) startBoundaryFallback(text);
        }, 280);
      };
      u.onboundary = () => {
        gotBoundary = true;
        sceneRef.current?.pulse(2);
        voiceSpike.current = 0.65 + Math.random() * 0.35;
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [pickVoice, startBoundaryFallback, stopBoundaryFallback, startVoiceEnvelope, stopVoiceEnvelope],
  );
```

with:

```tsx
  const speak = useCallback(
    (text: string) => {
      speakingRef.current = true;
      setSpeaking(true);
      startVoiceEnvelope();
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const clearTimers = () => {
        if (startWatchdog.current) {
          clearTimeout(startWatchdog.current);
          startWatchdog.current = null;
        }
        if (failsafeTimer.current) {
          clearTimeout(failsafeTimer.current);
          failsafeTimer.current = null;
        }
      };
      clearTimers(); // a new turn owns the timers
      const done = () => {
        clearTimers();
        speakingRef.current = false;
        setSpeaking(false);
        stopBoundaryFallback();
        stopVoiceEnvelope();
      };
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        startBoundaryFallback(text);
        failsafeTimer.current = setTimeout(done, Math.max(1500, (text.length / 12) * 1000));
        return;
      }
      // Cancel only when something is actually queued: an unconditional
      // cancel() right before speak() is the classic pattern that makes some
      // engines (iOS Safari, occasionally desktop Chrome) silently swallow
      // the new utterance.
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Light touch: neural voices sound most human near their natural pitch, so
      // we only nudge slightly for a calm, measured delivery.
      u.rate = 0.97;
      u.pitch = 0.96;
      u.lang = "en-GB";
      if (!voiceRef.current) voiceRef.current = pickVoice();
      if (voiceRef.current) u.voice = voiceRef.current;

      let gotBoundary = false;
      let started = false;
      u.onstart = () => {
        started = true;
        if (startWatchdog.current) {
          clearTimeout(startWatchdog.current);
          startWatchdog.current = null;
        }
        setTimeout(() => {
          if (!gotBoundary && speakingRef.current) startBoundaryFallback(text);
        }, 280);
      };
      u.onboundary = () => {
        gotBoundary = true;
        sceneRef.current?.pulse(2);
        voiceSpike.current = 0.65 + Math.random() * 0.35;
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);

      // Watchdog: some engines swallow utterances silently (no onstart, no
      // onerror). Keep the core performing; the failsafe below ends the turn.
      startWatchdog.current = setTimeout(() => {
        startWatchdog.current = null;
        if (!started && speakingRef.current) startBoundaryFallback(text);
      }, 1200);
      // Failsafe: even if onend never arrives, the turn always ends and the
      // buttons re-enable.
      failsafeTimer.current = setTimeout(done, Math.max(4000, (text.length / 10) * 1000 + 2000));
    },
    [pickVoice, startBoundaryFallback, stopBoundaryFallback, startVoiceEnvelope, stopVoiceEnvelope],
  );
```

- [ ] **Step 5: Rotate greetings in `onGreet`**

Replace:

```tsx
    sceneRef.current?.greet();
    speak(GREETING);
    window.setTimeout(() => setActive(false), 4500);
```

with:

```tsx
    sceneRef.current?.greet();
    if (!greetingBag.current) greetingBag.current = createGreetingBag();
    speak(greetingBag.current());
    window.setTimeout(() => setActive(false), 4500);
```

- [ ] **Step 6: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean; test count 56 (53 existing + 3 from Task 1).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/neural/page.tsx"
git commit -m "$(cat <<'EOF'
Rotate greetings and make speech failure unable to wedge the UI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scene trim — remove globe, volcanoes, texture, theme fields

**Files:**
- Modify: `lib/neural/scene.ts`
- Modify: `lib/neural/themes.ts`
- Modify: `lib/neural/themes.test.ts`
- Delete: `public/textures/earth_specular_2048.jpg`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NeuralTheme` loses `boundary` and `volcano` fields (no other file reads them — `scene.ts` is updated here; `ThemeSwitcher` uses only `name`/`swatch`/`accent`).

All public `NeuralScene` methods keep their signatures; this is deletion only.

- [ ] **Step 1: Update the theme tests first (RED)**

In `lib/neural/themes.test.ts`, delete these two lines from the "every palette is complete" test:

```ts
      expect(t.boundary).toBeInstanceOf(Color);
      expect(t.volcano).toBeInstanceOf(Color);
```

Run: `npm run test -- lib/neural/themes.test.ts`
Expected: PASS (removal can't fail — this step just keeps the tests ahead of the type change; the RED is the type-check in Step 3).

- [ ] **Step 2: Trim `lib/neural/themes.ts`**

Remove from the `NeuralTheme` type:

```ts
  /** Globe continent-outline color (HDR — values >1 feed bloom). */
  boundary: Color;
  volcano: Color;
```

Remove from EACH of the three palettes its `boundary:` line and `volcano:` line:
- Magma & Cyan: `boundary: new Color(0.0, 1.5, 3.0),` and `volcano: new Color(0xff5500),`
- Neon Void: `boundary: new Color(2.0, 0.0, 1.5),` and `volcano: new Color(0x00ff00),`
- Solar Flare: `boundary: new Color(1.5, 1.5, 2.5),` and `volcano: new Color(0xffffff),`

Also update the module doc comment: change "core gradient, vein pulses, globe outline, volcano points, dust, fog/background" to "core gradient, vein pulses, dust, fog/background".

- [ ] **Step 3: Verify the type-check now fails (RED for scene.ts)**

Run: `npx tsc --noEmit`
Expected: FAIL — `lib/neural/scene.ts` references `boundaryColor`/`tgt.boundary`/`tgt.volcano` that no longer exist. This confirms the fields were only consumed by the scene.

- [ ] **Step 4: Trim `lib/neural/scene.ts`**

Apply all of these deletions:

1. Class fields — delete both lines:
```ts
  private volcanoMat!: THREE.ShaderMaterial;
  private earthTex: THREE.Texture | null = null;
```
2. Uniforms object — delete both entries:
```ts
    boundaryColor: { value: THEMES[0].boundary.clone() },
    tEarth: { value: null as THREE.Texture | null },
```
3. In `init()` — delete the texture loader block:
```ts
    this.earthTex = new THREE.TextureLoader().load(
      "/textures/earth_specular_2048.jpg",
      undefined,
      undefined,
      () => console.warn("NeuralScene: failed to load Earth texture; globe outlines will be dark"),
    );
    this.uniforms.tEarth.value = this.earthTex;
```
4. In `init()` — delete the two build calls:
```ts
    this.buildGlobe();
    this.buildVolcanoes();
```
5. Delete the ENTIRE `buildGlobe()` private method (from its `// ─── Earth-outline globe shell ───…` comment through its closing `}`), and the ENTIRE `buildVolcanoes()` private method (from its `// ─── Volcano points ───…` comment through its closing `}`).
6. In `animate()` — delete the two lerp lines:
```ts
    this.uniforms.boundaryColor.value.lerp(tgt.boundary, THEME_LERP);
```
```ts
    (this.volcanoMat.uniforms.color.value as THREE.Color).lerp(tgt.volcano, THEME_LERP);
```
7. In `dispose()` — delete:
```ts
    this.earthTex?.dispose();
```
8. In the file's top doc comment, update the description: remove the mentions of the Earth-outline globe shell and volcano points (e.g. "…bezier energy veins that pulse inward from an Earth-outline globe shell, with volcano points, a dust field…" becomes "…bezier energy veins that pulse inward toward the core, with a dust field…").

If any listed snippet does not match the file exactly, STOP and report the mismatch rather than improvising.

- [ ] **Step 5: Delete the texture**

```bash
git rm public/textures/earth_specular_2048.jpg
```

- [ ] **Step 6: Full gate (GREEN)**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 56 tests. Also run `grep -rn "boundary\|volcano\|tEarth\|earthTex" lib/neural/scene.ts lib/neural/themes.ts` — expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/neural/scene.ts lib/neural/themes.ts lib/neural/themes.test.ts
git commit -m "$(cat <<'EOF'
Remove Earth globe and volcano points from the neural scene

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

(The `git rm` from Step 5 is already staged and lands in this commit.)
