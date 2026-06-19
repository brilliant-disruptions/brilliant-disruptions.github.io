# JARVIS Neural Interface — Session Artifact

_Brilliant Disruptions · jarvis-app · generated from build session_

A voice-driven, Iron-Man-style holographic "JARVIS" interface built into the
member-gated Next.js console.

---

## 1. What was built (in order)

| PR | Change | Status |
|----|--------|--------|
| #5 | Initial neural interface in `jarvis-app` — Three.js neuron "brain" + scripted intent engine + Web Speech voice, member-gated `/neural` route | merged |
| #6 | Replaced mic input with a **"Hi, I'm JARVIS"** greeting button | merged |
| #8 | **Iron Man HUD redesign** — arc-reactor brain with bloom, rotating reticle rings, radar sweep, telemetry panels, gold frame, cinematic boot, synthesized UI sound | merged |
| #9 | **Polish** — compact "little brain" centered in rings, softer bloom, calmer/slower rings, louder boot/greeting | merged |
| #10 | **Realistic voice** — picker scores toward neural / "Online (Natural)" browser voices; softer cadence | merged |
| #12 | **Voiceprint brain** — the whole brain ripples/breathes in sync with speech (shader `uVoice` driven by a speech envelope) | merged |
| #11 | **Declutter** — keep only the bottom-right Voice·Output panel | merged |

Net result at `jarvis.brilliantdisruptions.com/neural`:
**ENGAGE → cinematic boot → compact neuron brain in calm gold/cyan rings →
click "Hi, I'm JARVIS" → the brain ripples as it speaks aloud in a British
neural voice.**

---

## 2. Architecture & deployment (important)

There are **two separate sites** in this repo:

- **`brilliantdisruptions.com`** — static **GitHub Pages** marketing site (repo
  root: `index.html`, `css/`, `js/`, `projects/`). Includes an **older** static
  demo at `/jarvis.html` (original Web-Speech version). _None of the HUD work is
  here._
- **`jarvis.brilliantdisruptions.com`** — the **Next.js `jarvis-app`**, deployed
  to **Vercel**. All HUD/voice/voiceprint work lives here at the **`/neural`**
  route, which is **members-only** (Supabase auth; logged-out users are
  redirected to `/login`).

> Merging PRs updates the Vercel app, not GitHub Pages. If a change "isn't
> reflected," confirm the Vercel project bound to `jarvis.brilliantdisruptions.com`
> has **Production Branch = `main`** and that its latest production deployment
> matches the newest `main` commit.

---

## 3. File map (jarvis-app)

```
app/(app)/neural/page.tsx          # orchestrator: engage→boot→live, speak(), greet button
app/(app)/layout.tsx               # member auth gate (Supabase) — wraps /neural
lib/neural/scene.ts                # Three.js brain: nodes, synapses, pulses, bloom,
                                   #   state machine, greet(), setVoiceLevel() (voiceprint)
lib/neural/sound.ts                # HudSound: synthesized boot/power-up/blip/ambient (Web Audio)
lib/neural/intents.ts              # scripted keyword→reply engine (currently unused by page)
lib/neural/mic-analyser.ts         # live-mic loudness → brain (from the old voice-input version)
components/neural/HudRings.tsx      # rotating reticle rings, gold arcs, radar sweep
components/neural/HudPanels.tsx     # Voice·Output telemetry panel + speaking waveform
components/neural/BootSequence.tsx  # ~2.4s cinematic power-on
app/globals.css                    # design tokens (cyan/violet/magenta/gold) + HUD keyframes
supabase/functions/ai-gateway/index.ts  # EXISTING Claude integration (Deno edge function)
components/CommandBar.tsx           # existing client pattern calling ai-gateway
```

### Key `NeuralScene` API (`lib/neural/scene.ts`)
`init()` · `setState('idle'|'listening'|'thinking'|'speaking'|'greeting')` ·
`pulse(count)` · `setAmplitude(0..1)` · `setVoiceLevel(0..1)` (drives the
voiceprint ripple) · `greet()` · `dispose()`.

---

## 4. Run it locally

```bash
cd jarvis-app
cp .env.example .env.local      # NOTE: no .env.example in repo — create .env.local manually
npm install
npm run dev                     # http://localhost:3000
```

`.env.local` needs (client-side Supabase):
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

**Auth on `/neural` (member gate)** — enforced in `app/(app)/layout.tsx`
(checks an active row in the Supabase `members` table). For local dev either:
- create a member row after signing up at `/login`, or
- add a **dev-only bypass** (guarded to `process.env.NODE_ENV !== 'production'`)
  around the membership check.

---

## 5. Next step we were scoping: talk to Claude locally + Wispr Flow

> Not yet implemented — this is the proposed design. The neural page currently
> only speaks a scripted greeting; it does **not** call Claude.

### A. Give JARVIS a real brain (recommended: a local Next.js API route)
`@anthropic-ai/sdk` is **not** installed yet, and there are no `app/api/*`
routes. Add a server route so the key stays server-side and it works both
locally (`.env.local`) and on Vercel (env var):

```ts
// app/api/jarvis/route.ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { messages } = await req.json(); // [{role:'user'|'assistant', content}]
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system:
      "You are JARVIS, the AI interface for Brilliant Disruptions. " +
      "Reply in a calm, concise, slightly witty British-butler tone. " +
      "Keep answers to 1–3 sentences so they're pleasant when spoken aloud.",
    messages,
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  return Response.json({ text });
}
```
- Add `ANTHROPIC_API_KEY=...` to `.env.local`.
- Add `/api/jarvis` to the public paths in `proxy.ts` (or require a session).
- _Alternative:_ reuse the existing `ai-gateway` edge function
  (`supabase.functions.invoke("ai-gateway", { body: { prompt } })`, see
  `CommandBar.tsx`) — production parity, but needs the function deployed with the
  key and a logged-in member.

### B. Wire the neural page to converse
In `app/(app)/neural/page.tsx`, keep a `messages` history; on submit:
`fetch('/api/jarvis', {messages})` → `speak(reply)` (existing function already
drives the voiceprint brain + TTS). Set `setState('thinking')` while awaiting.

### C. Wispr Flow for input
Wispr Flow is a **system dictation app** — it types transcribed speech into
whatever text field is focused. So add a focused **conversation text box** in the
HUD; press Wispr Flow's hotkey, speak, then Enter to send. (Optionally also keep
a browser-mic button via the Web Speech API as a fallback.) No in-page Whisper
library is required.

### Models
Repo defaults: `claude-sonnet-4-6` (fast/default), `claude-opus-4-8` (heavy).
Sonnet is the right default for snappy spoken replies.

---

## 6. Honest limitations noted during the build

- Browser **Web Speech** synthesis quality varies by device; truly identical
  "human" voice everywhere needs a paid neural TTS (ElevenLabs / Azure / OpenAI)
  — easy to add later via the same API-route pattern.
- The **voiceprint** ripple is synced to speech _timing_ (word boundaries), not
  literal audio analysis — browsers don't expose the TTS waveform.
- WebGL/bloom is desktop-only; mobile and `prefers-reduced-motion` degrade
  gracefully; WebGL-off shows a CSS-gradient fallback.

---

## 7. Quick links
- Live (members only): `https://jarvis.brilliantdisruptions.com/neural`
- Static legacy demo (public): `https://brilliantdisruptions.com/jarvis.html`
- App code: `jarvis-app/` · Neural page: `app/(app)/neural/page.tsx`
