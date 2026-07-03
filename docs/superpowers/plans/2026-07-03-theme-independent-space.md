# Theme-Independent Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the background and nebula to constant deep-space colors so theme switches only re-tint the machine (core, veins, halo, flares, dust).

**Architecture:** One constant replaces the per-theme `bg` channel; the per-frame background lerp is deleted; the nebula's theme uniform becomes a fixed GLSL constant. `bg` leaves the theme data model.

**Tech Stack:** three@0.158, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-theme-independent-space-design.md`

## Global Constraints

- Work from `/Users/michaelwilt/Documents/1 Projects/Github/brilliant-disruptions.github.io/jarvis-app`; only `lib/neural/scene.ts`, `lib/neural/themes.ts`, `lib/neural/themes.test.ts` change.
- Constants: `SPACE_BG = 0x01030a`; nebula haze `vec3(0.35, 0.45, 0.85)`; all existing gains unchanged.
- Commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Fix space colors, drop the bg theme channel

**Files:**
- Modify: `lib/neural/scene.ts`, `lib/neural/themes.ts`, `lib/neural/themes.test.ts`

**Interfaces:**
- Produces: `NeuralTheme` loses `bg` (no other file reads it — the scene edit in this same task removes the only consumer).

- [ ] **Step 1: Update the theme test (RED via type-check later)**

In `lib/neural/themes.test.ts`, delete the line:

```ts
      expect(t.bg).toBeInstanceOf(Color);
```

- [ ] **Step 2: Trim `lib/neural/themes.ts`**

Delete `bg: Color;` from the `NeuralTheme` type and the `bg:` line from ALL FIVE palettes:
- Magma & Cyan: `bg: new Color(0x010102),`
- Hot Rod & Gold: `bg: new Color(0x050102),`
- Arc Reactor: `bg: new Color(0x000208),`
- Falcon: `bg: new Color(0x02040a),`
- Solar Flare: `bg: new Color(0x000103),`

In the module doc comment, remove the ", fog/background" mention (adjust the channel list to end with "dust").

Run: `npx tsc --noEmit` — expected FAIL: `lib/neural/scene.ts` still reads `THEMES[0].bg` / `tgt.bg`. That confirms the scene is the only consumer.

- [ ] **Step 3: Fix the scene**

In `lib/neural/scene.ts`:

1. Beside the other constants, after the line `const THEME_LERP = 0.05; // per-frame color convergence, as in the pen`, add:

```ts
const SPACE_BG = 0x01030a; // fixed deep-space background — themes never touch it
```

2. Replace:

```ts
    this.scene.fog = new THREE.FogExp2(THEMES[0].bg.getHex(), 0.012);
```

with:

```ts
    this.scene.fog = new THREE.FogExp2(SPACE_BG, 0.012);
```

3. In `animate()`, DELETE these two lines:

```ts
    (this.scene.fog as THREE.FogExp2).color.lerp(tgt.bg, THEME_LERP);
    this.renderer.setClearColor((this.scene.fog as THREE.FogExp2).color);
```

4. In `buildNebula()`'s fragment shader, DELETE the line `uniform vec3 cSurface;` and replace:

```ts
          vec3 color = cSurface * n * 0.16;
```

with:

```ts
          vec3 color = vec3(0.35, 0.45, 0.85) * n * 0.16;
```

If any snippet doesn't match exactly, STOP and report the mismatch.

- [ ] **Step 4: Full gate (GREEN)**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean, 61 tests. Also `grep -n "bg" lib/neural/themes.ts lib/neural/themes.test.ts` — expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/neural/scene.ts lib/neural/themes.ts lib/neural/themes.test.ts
git commit -m "$(cat <<'EOF'
Fix space to a constant backdrop; themes only re-tint the machine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
