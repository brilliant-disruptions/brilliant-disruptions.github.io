# Air Hockey tab — design

## Summary

Add a new top-level "Air Hockey" tab to Jarvis, sibling to Neural (not nested
under it), that ports the CodePen [Air Hockey](https://codepen.io/michaeljwilt/pen/MYJORbg)
game — a neon Canvas 2D air hockey game with CPU opponent, physics, particles,
confetti, slo-mo game-point drama, and stats tracking — into a native React
page.

## Source material

The pen (`michaeljwilt/MYJORbg`, title "Air Hockey 🔘🥅") is self-contained
vanilla HTML/CSS/JS with two external stylesheets configured in Pen Settings:

- Google Fonts: `Orbitron:wght@400;700;900` and `Rajdhani:wght@300;400;500;600;700`
- Font Awesome 6.5.0 `all.min.css` — unused by the actual markup/CSS/JS (no
  `fa-` class appears anywhere in the source); dropped from the port.

Source sizes: HTML ~1.9KB, CSS ~6.9KB, JS ~34.9KB. The JS is a single flat
script (module-level `const`/`let` state, `requestAnimationFrame` loop,
`document.getElementById` DOM writes for stats/screens, Web Audio SFX
synthesized procedurally — no external audio assets).

## Architecture

### `lib/air-hockey/game.ts`

A framework-agnostic `AirHockeyGame` class, following the same shape as
`lib/neural/scene.ts` (`NeuralScene`): a doc comment noting it's ported from
the CodePen URL, constructed with a `<canvas>` element and a callbacks object,
driven via `init()` / `dispose()` plus play methods, with no framework
dependencies.

It owns, translated to TypeScript with typed fields but no behavior changes:

- Canvas 2D rendering loop (table, puck, mallets, particles, confetti, screen
  shake, goal flash, speed-up banner, slo-mo vignette/letterbox/game-point
  label)
- Physics: puck/wall/goal collision, mallet-puck collision & impulse,
  friction, puck speed escalation every 2 goals
- CPU opponent AI (reaction lerp, deliberate mistake chance, corner escape,
  home positioning)
- Particle bursts, spark lines, confetti spawn/update
- Web Audio SFX (hit, wall, goal, victory, speedup, slomo-in) — synthesized
  procedurally, no audio files
- Mouse + touch input, scaled to canvas coordinates and clamped to the
  player's half of the table

It does **not** touch the DOM for anything React should own. Where the
original script wrote directly to `#score-p`, `#stat-p-streak`,
`#gameover-screen`, etc., the class instead calls constructor-supplied
callbacks:

```ts
type AirHockeyCallbacks = {
  onStats: (stats: { p: SideStats; cpu: SideStats }) => void;
  onGameOver: (result: { winner: "p" | "cpu"; final: string } | null) => void;
  onMuteChange: (muted: boolean) => void;
};
```

Everything purely visual (the canvas drawing itself — table, puck trail,
mallets, particles, confetti, goal flash text, speed-up banner, slo-mo
overlay) stays inside the class exactly as in the original; only the
DOM-facing side panels/overlay move to React.

### `app/(app)/air-hockey/page.tsx`

Client component, sibling of `neural/page.tsx`, living under the same
`(app)` layout — inherits TopBar, member-gating, and CommandBar for free
(no auth work needed).

- `canvasRef` + `gameRef` (an `AirHockeyGame` instance), constructed/`init()`'d
  in a mount `useEffect`, `dispose()`'d on unmount — same lifecycle shape as
  the Neural page's `NeuralScene`.
- React state: `score`, `stats.p` / `stats.cpu` (streak, top speed, power
  hits), `muted`, `gameOver` (null or `{ winner, final }`), fed by the
  callbacks above.
- Renders: two stat panels (YOU / CPU) flanking the canvas, a mute-status
  indicator, and a game-over overlay with "PLAY AGAIN" wired to
  `gameRef.current.startGame()`.

### Nav entry

Add `["Air Hockey", "/air-hockey"]` to the `TABS` array in
`components/TopBar.tsx`, after the existing tabs and before Neural (order is
cosmetic, not load-bearing).

## Visual integration

- **Layout**: normal tab page — TopBar and tab nav stay visible (not a
  full-screen takeover like Neural). Arena sits centered in the content
  column beneath the tab bar, same as Overview/Engineering/etc.
- **Color palette**: DOM chrome (stat panels, mute pill, game-over overlay)
  is rebuilt with Tailwind + the app's existing CSS vars — `var(--cyan)` for
  the player side, `var(--danger)` for the CPU side, `var(--gold)` for
  accents — instead of the pen's own hardcoded `--blue`/`--red`/`--gold` hex
  values, so it reads as part of Jarvis rather than a second color system.
  Canvas-internal rendering (gradients, glows, particle colors) keeps its own
  hex constants since `CanvasRenderingContext2D` fill/stroke styles can't
  reference CSS custom properties directly, but those constants are seeded
  from the same hex values backing `--cyan`/`--danger`/`--gold` so the canvas
  and the DOM chrome match.
- **Responsive scaling**: the pen scales its entire `#outer` layout via a
  `@media (max-width: 1100px) { transform: scale(calc(100vw / 1100)) }` trick,
  which assumes the pen owns the full viewport. Since the arena now lives
  inside a padded, `max-w-[1600px]` content column instead of the raw
  viewport, this is replaced with a `ResizeObserver` on the arena wrapper that
  measures the wrapper's actual rendered width and applies an equivalent
  `scale()` transform — same visual scaling behavior, correct in the new
  layout context.
- **Fonts**: add `Orbitron` (400/700/900) and `Rajdhani` (300–700) via
  `next/font/google`, matching the exact pattern already used in
  `app/layout.tsx` for Space Grotesk/Inter/JetBrains Mono — but scoped to the
  air-hockey page only (its own `.variable` className on the page's top-level
  wrapper div) rather than the root layout, since no other tab needs them.
  Canvas text (`G.font = '900 64px "Orbitron"'`) and DOM labels reference the
  same font family names, resolved via the scoped CSS variables.
- Font Awesome is dropped (see Source material above — unused).

## Testing

- `lib/air-hockey/game.ts` is framework-agnostic like `NeuralScene`; matching
  existing convention in `lib/neural/`, canvas rendering itself is not
  unit-tested (only pure-logic helpers like `greetings.ts`/`intents.ts` get
  `.test.ts` files in that directory, and this game's logic is not split out
  into similarly pure standalone helpers).
- Manual verification via the dev server: play a full match (hit the puck
  enough times to confirm score/streak/top-speed/power-hit stats update),
  trigger a goal flash and confirm game-point slo-mo kicks in at 6-6/6-x,
  finish a match and confirm the game-over overlay shows the right
  winner/face/final score and "PLAY AGAIN" resets the match, toggle mute with
  the `S` key, and confirm the new "Air Hockey" tab appears in nav and
  navigates correctly without disturbing other tabs.

## Out of scope

- No Supabase persistence of scores/stats — this is a local, in-memory arcade
  game like the pen, not a tracked feature.
- No full-screen takeover treatment (that's Neural's specific style, not
  requested here).
- No changes to the Neural tab or its files.
