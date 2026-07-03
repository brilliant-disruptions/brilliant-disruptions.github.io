# Mic Removal + Greetings Copy + Palette Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the tap-to-talk mic button from the Neural page, apply the approved 8-line greeting set, and replace the pink "Neon Void" palette with three new ones (Hot Rod & Gold, Arc Reactor, Falcon — 5 themes total).

**Architecture:** Three independent edits: page-only surgery (mic UI + its wiring out; voice modules stay in the repo untouched), a data swap in `greetings.ts` (tests pass unchanged), and a data overhaul in `themes.ts` + its test. Everything downstream consumes `THEMES` generically, so 5 palettes need no other code changes.

**Tech Stack:** Next.js 16 / React 19, TypeScript, three@0.158, vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-mic-removal-greetings-palettes-design.md`

## Global Constraints

- Work happens inside `jarvis-app/`; run all npm commands from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`.
- Files that must NOT change: `lib/neural/listen.ts`, `lib/neural/mic-analyser.ts`, `lib/neural/intents.ts` and all their tests — the voice modules stay, tested, for a future return.
- Greeting copy is applied EXACTLY as listed in Task 1 (em dashes, ellipses, punctuation included). `Hi Jimmy, I love that for you.` stays verbatim.
- Palette values are applied EXACTLY as listed in Task 2; final theme order: Magma & Cyan, Hot Rod & Gold, Arc Reactor, Falcon, Solar Flare.
- Total test count stays 61 (assertion updates only, no test count change).
- No dependency changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: New greeting copy

**Files:**
- Modify: `lib/neural/greetings.ts`

**Interfaces:**
- Consumes/Produces: `GREETINGS: string[]` shape unchanged (8 unique lines) — existing tests (length 8, Jimmy verbatim, uniqueness, shuffle bag) must pass UNCHANGED. If any test needs editing, that's a bug in your change, not the tests.

- [ ] **Step 1: Replace the array contents**

In `lib/neural/greetings.ts`, replace the entire `GREETINGS` array literal:

```ts
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
```

with:

```ts
export const GREETINGS: string[] = [
  "Hi Jimmy, I love that for you.",
  "Good evening, sir. The suit is in the wash — this hologram will have to do.",
  "Systems online. Sarcasm calibrated to factory settings.",
  "Welcome back. I've taken the liberty of judging your browser history.",
  "All systems operational. Unlike your sleep schedule.",
  "At your service, sir. Reluctantly. But at your service.",
  "Online. Shall I save the world today, or just the quarterly forecast?",
  "Diagnostics complete: charm at one hundred percent. Humility... not found.",
];
```

- [ ] **Step 2: Run the greetings tests unchanged**

Run: `npm run test -- lib/neural/greetings.test.ts`
Expected: PASS (3 tests, untouched).

- [ ] **Step 3: Commit**

```bash
git add lib/neural/greetings.ts
git commit -m "$(cat <<'EOF'
Rewrite greetings in a dry Stark-butler voice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Palette overhaul

**Files:**
- Modify: `lib/neural/themes.ts`
- Modify: `lib/neural/themes.test.ts`

**Interfaces:**
- Produces: `THEMES` still `NeuralTheme[]` with the same field shape — now 5 entries in the order: `Magma & Cyan`, `Hot Rod & Gold`, `Arc Reactor`, `Falcon`, `Solar Flare`. Consumers (scene lerp, ThemeSwitcher, page `theme` state) are generic over length — no other files change.

- [ ] **Step 1: Update the test first**

In `lib/neural/themes.test.ts`, replace:

```ts
  it("defines exactly three palettes", () => {
    expect(THEMES).toHaveLength(3);
    expect(THEMES.map((t) => t.name)).toEqual(["Magma & Cyan", "Neon Void", "Solar Flare"]);
  });
```

with:

```ts
  it("defines exactly five palettes", () => {
    expect(THEMES).toHaveLength(5);
    expect(THEMES.map((t) => t.name)).toEqual([
      "Magma & Cyan",
      "Hot Rod & Gold",
      "Arc Reactor",
      "Falcon",
      "Solar Flare",
    ]);
  });
```

Run: `npm run test -- lib/neural/themes.test.ts`
Expected: FAIL (still 3 palettes) — this is the RED.

- [ ] **Step 2: Rewrite the THEMES array**

In `lib/neural/themes.ts`, DELETE the entire "Neon Void" entry and INSERT the three new entries between "Magma & Cyan" and "Solar Flare" (keep those two entries exactly as they are), so the array reads: Magma & Cyan, then these three, then Solar Flare:

```ts
  {
    name: "Hot Rod & Gold",
    swatch: "linear-gradient(135deg, #b3001b, #ffcf40)",
    accent: "#ffcf40",
    core: [
      new Color(0.08, 0.0, 0.01),
      new Color(0.75, 0.02, 0.05),
      new Color(1.0, 0.25, 0.05),
      new Color(1.0, 0.8, 0.25),
    ],
    vein: {
      surface: new Color(0.55, 0.85, 1.0),
      coreA: new Color(0.9, 0.1, 0.05),
      coreB: new Color(1.0, 0.75, 0.2),
    },
    dust: new Color(0x332211),
    bg: new Color(0x050102),
  },
  {
    name: "Arc Reactor",
    swatch: "linear-gradient(135deg, #0a2f66, #cfeaff)",
    accent: "#7fd4ff",
    core: [
      new Color(0.0, 0.02, 0.08),
      new Color(0.05, 0.25, 0.8),
      new Color(0.3, 0.7, 1.0),
      new Color(1.3, 1.4, 1.5),
    ],
    vein: {
      surface: new Color(1.0, 0.85, 0.45),
      coreA: new Color(0.1, 0.5, 1.0),
      coreB: new Color(0.6, 0.9, 1.0),
    },
    dust: new Color(0x112a44),
    bg: new Color(0x000208),
  },
  {
    name: "Falcon",
    swatch: "linear-gradient(135deg, #1b2735, #e8eef5)",
    accent: "#c9d4e0",
    core: [
      new Color(0.02, 0.03, 0.05),
      new Color(0.35, 0.4, 0.5),
      new Color(0.8, 0.85, 0.95),
      new Color(1.4, 1.4, 1.5),
    ],
    vein: {
      surface: new Color(0.85, 0.92, 1.0),
      coreA: new Color(0.5, 0.6, 0.75),
      coreB: new Color(1.0, 1.0, 1.0),
    },
    dust: new Color(0x2a3340),
    bg: new Color(0x02040a),
  },
```

Also update the module doc comment if it mentions "three palettes" (make it "the palettes").

- [ ] **Step 3: Run themes tests (GREEN)**

Run: `npm run test -- lib/neural/themes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add lib/neural/themes.ts lib/neural/themes.test.ts
git commit -m "$(cat <<'EOF'
Replace Neon Void with Hot Rod & Gold, Arc Reactor, and Falcon palettes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Remove the mic button and its wiring

**Files:**
- Modify: `app/(app)/neural/page.tsx`

**Interfaces:**
- Consumes: nothing new. After this task the page's only interaction handlers are `onThemeChange` and `onGreet`.
- Produces: the final page. `lib/neural/listen.ts`, `mic-analyser.ts`, `intents.ts` become unimported by the page but MUST remain in the repo with their tests.

Apply these edits in order. If any snippet doesn't match exactly, STOP and report the mismatch.

- [ ] **Step 1: Imports**

Delete these four lines:

```tsx
import { JarvisListener } from "@/lib/neural/listen";
import { MicAnalyser } from "@/lib/neural/mic-analyser";
import { matchIntent } from "@/lib/neural/intents";
```

and (THEMES was only used by the mic button's glow):

```tsx
import { THEMES } from "@/lib/neural/themes";
```

- [ ] **Step 2: Refs and state**

Delete these lines:

```tsx
  const synthUnlockedRef = useRef(false);
```

```tsx
  const listenerRef = useRef<JarvisListener | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);
  const listenSession = useRef(0);
```

```tsx
  const [micState, setMicState] = useState<"idle" | "listening">("idle");
  const [micSupported, setMicSupported] = useState(false);
```

- [ ] **Step 3: Lifecycle effect**

Delete these lines from the mount body:

```tsx
    listenerRef.current = new JarvisListener();
    setMicSupported(JarvisListener.isSupported());
```

and these from the cleanup (the speakSession pair below them STAYS):

```tsx
      // eslint-disable-next-line react-hooks/exhaustive-deps -- counter ref, not a DOM node: the live value must be bumped so a getUserMedia still pending at unmount resolves into an already-dead session
      listenSession.current++;
      listenerRef.current?.stop();
      listenerRef.current = null;
      micRef.current?.stop();
      micRef.current = null;
```

- [ ] **Step 4: Delete `unlockSynthesis` and `onMic` entirely**

Delete the whole `unlockSynthesis` arrow function (lines beginning `const unlockSynthesis = () => {` through its closing `};` — `onMic` was its last caller) and the whole `onMic` handler (from `const onMic = () => {` through its closing `};` including the comment block inside).

- [ ] **Step 5: Simplify `onGreet`'s guard**

Replace:

```tsx
    if (active || speaking || micState === "listening") return;
```

with:

```tsx
    if (active || speaking) return;
```

- [ ] **Step 6: JSX**

On the greet button, replace:

```tsx
              disabled={active || speaking || micState === "listening"}
```

with:

```tsx
              disabled={active || speaking}
```

Then delete the entire mic button block — from `{micSupported && (` through its matching `)}` (the `<button>` with the mic `<svg>` inside). The flex wrapper `<div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">` stays.

- [ ] **Step 6b: Update the file-top doc comment**

The page's doc comment still describes the mic. Rewrite the sentence that mentions it — the comment should describe: magma core visualization, the greet button speaking a rotating greeting while the core reacts theatrically (flares, swell, bloom), theme switcher bottom-left, voice-only (no captions). Keep the comment's existing style; no sentence may mention the mic, listening, or tap-to-talk.

- [ ] **Step 7: Full gate**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 61 tests (voice-module tests still run and pass). Also: `grep -n "mic\|listen\|Listener\|matchIntent\|unlockSynthesis" "app/(app)/neural/page.tsx"` — expected: no output.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/neural/page.tsx"
git commit -m "$(cat <<'EOF'
Remove the mic button for now; voice modules stay for a future return

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
