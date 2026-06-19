"use client";

/**
 * JARVIS Neural Interface — a member-gated, full-screen Iron Man HUD.
 *
 * Flow: ENGAGE (unlocks audio) → cinematic boot → live HUD. The neuron brain is
 * an arc-reactor core (Three.js + bloom) wrapped in rotating reticle rings, a
 * radar sweep, a gold frame and live telemetry panels. The "Hi, I'm JARVIS"
 * button fires a color-cycling burst with a power-up sound while JARVIS speaks.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeuralScene } from "@/lib/neural/scene";
import { HudSound } from "@/lib/neural/sound";
import { HudRings } from "@/components/neural/HudRings";
import { HudPanels } from "@/components/neural/HudPanels";
import { BootSequence } from "@/components/neural/BootSequence";

const GREETING = "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.";
type Phase = "engage" | "booting" | "live";

export default function NeuralPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NeuralScene | null>(null);
  const soundRef = useRef<HudSound | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const boundaryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const synthUnlockedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("engage");
  const [active, setActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [webglOk, setWebglOk] = useState(true);

  // ─── Scene + sound lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new NeuralScene(canvasRef.current);
    const ok = scene.init();
    sceneRef.current = scene;
    setWebglOk(ok);
    soundRef.current = new HudSound();
    return () => {
      scene.dispose();
      sceneRef.current = null;
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  // ─── Speech synthesis ──────────────────────────────────────────────────────
  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Score voices toward the most human-sounding option a device exposes:
    // neural / "Online (Natural)" voices read far more realistically than the
    // older local ones. Prefer a British male neural voice, degrade gracefully.
    const pool = voices.filter((v) => /^en/i.test(v.lang));
    const candidates = pool.length ? pool : voices;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (/natural|neural/.test(n)) s += 100; // neural engine = realistic
      if (/online/.test(n)) s += 40; // online neural voices
      if (!v.localService) s += 8; // remote voices are usually the neural ones
      if (/en[-_]gb/i.test(v.lang)) s += 30; // British
      else if (/^en/i.test(v.lang)) s += 10;
      if (/(ryan|george|thomas|arthur|daniel|oliver|brian|guy)\b/.test(n) || /\bmale\b/.test(n)) s += 20;
      if (/google uk english male/.test(n)) s += 25;
      if (/google/.test(n)) s += 6;
      return s;
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? voices[0];
  }, []);

  const stopBoundaryFallback = useCallback(() => {
    if (boundaryTimer.current) {
      clearInterval(boundaryTimer.current);
      boundaryTimer.current = null;
    }
  }, []);

  const startBoundaryFallback = useCallback(
    (text: string) => {
      const perPulse = 180;
      const est = Math.max(1200, (text.length / 12) * 1000);
      let elapsed = 0;
      boundaryTimer.current = setInterval(() => {
        elapsed += perPulse;
        sceneRef.current?.pulse(2);
        sceneRef.current?.setAmplitude(0.5 + Math.random() * 0.4);
        if (elapsed >= est) stopBoundaryFallback();
      }, perPulse);
    },
    [stopBoundaryFallback],
  );

  const speak = useCallback(
    (text: string) => {
      speakingRef.current = true;
      setSpeaking(true);
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const done = () => {
        speakingRef.current = false;
        setSpeaking(false);
        stopBoundaryFallback();
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
        sceneRef.current?.setAmplitude(0.6 + Math.random() * 0.4);
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [pickVoice, startBoundaryFallback, stopBoundaryFallback],
  );

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    voiceRef.current = pickVoice();
    const onVoices = () => {
      voiceRef.current = pickVoice();
    };
    synth.addEventListener("voiceschanged", onVoices);
    const onHidden = () => {
      if (document.hidden) synth.cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      synth.removeEventListener("voiceschanged", onVoices);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pickVoice]);

  const unlockSynthesis = () => {
    if (synthUnlockedRef.current) return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    synthUnlockedRef.current = true;
  };

  // ─── Flow ──────────────────────────────────────────────────────────────────
  const onEngage = () => {
    soundRef.current?.unlock();
    soundRef.current?.boot();
    unlockSynthesis();
    setPhase("booting");
  };

  const onBootComplete = useCallback(() => {
    setPhase("live");
    soundRef.current?.startAmbient();
  }, []);

  const onGreet = () => {
    if (active) return;
    setActive(true);
    soundRef.current?.powerUp();
    sceneRef.current?.greet();
    speak(GREETING);
    window.setTimeout(() => setActive(false), 4500);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#04060a] text-[var(--white)]">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      {!webglOk && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 42% 50%, rgba(0,229,255,0.28), transparent 28%), radial-gradient(circle at 58% 50%, rgba(124,58,237,0.28), transparent 28%)",
            filter: "blur(8px)",
          }}
        />
      )}

      {/* scanline veil */}
      <div aria-hidden className="hud-scanlines pointer-events-none absolute inset-0 opacity-30" />

      {/* gold frame */}
      <div aria-hidden className="pointer-events-none absolute inset-3 sm:inset-5">
        <div className="absolute inset-0 border" style={{ borderColor: "rgba(0,229,255,0.16)" }} />
        {(["left-0 top-0 border-l border-t", "right-0 top-0 border-r border-t", "left-0 bottom-0 border-l border-b", "right-0 bottom-0 border-r border-b"] as const).map(
          (c, i) => (
            <div key={i} className={`absolute h-6 w-6 ${c}`} style={{ borderColor: "var(--gold)" }} />
          ),
        )}
      </div>

      {/* live HUD chrome */}
      {phase === "live" && (
        <>
          <HudRings active={active} />
          <HudPanels speaking={speaking} />

          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-10">
            <header className="flex items-center justify-between">
              <Link
                href="/overview"
                className="pointer-events-auto font-mono text-xs tracking-widest text-[var(--muted-hi)] transition hover:text-[var(--cyan)]"
              >
                ← CONSOLE
              </Link>
              <div className="hidden font-mono text-[11px] tracking-[0.2em] text-[var(--gold)] sm:block">
                MK XLII · {active ? "ACTIVE" : "IDLE"}
              </div>
            </header>

            <div className="flex-1" />

            <footer className="flex flex-col items-center gap-4">
              <button
                onClick={onGreet}
                disabled={active}
                className="pointer-events-auto px-9 py-4 font-display text-base font-semibold tracking-wide backdrop-blur transition disabled:opacity-80"
                style={{
                  clipPath: "polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px))",
                  background: active ? "rgba(255,179,71,0.14)" : "rgba(0,229,255,0.1)",
                  border: `1.5px solid ${active ? "var(--gold)" : "var(--cyan)"}`,
                  color: active ? "var(--gold-bright)" : "var(--white)",
                  boxShadow: active ? "0 0 36px rgba(255,179,71,0.45)" : "0 0 24px rgba(0,229,255,0.3)",
                }}
              >
                {active ? "JARVIS ONLINE…" : "Hi, I'm JARVIS"}
              </button>
            </footer>
          </div>
        </>
      )}

      {/* boot sequence */}
      {phase === "booting" && <BootSequence onComplete={onBootComplete} />}

      {/* engage gate */}
      {phase === "engage" && (
        <div className="absolute inset-0 z-30 grid place-items-center">
          <button
            onClick={onEngage}
            className="pointer-events-auto grid place-items-center rounded-full font-display text-lg font-semibold tracking-[0.3em] text-[var(--cyan)] transition hover:text-[var(--white)]"
            style={{
              width: "180px",
              height: "180px",
              background: "rgba(0,229,255,0.06)",
              border: "1.5px solid var(--cyan)",
              boxShadow: "0 0 50px rgba(0,229,255,0.3), inset 0 0 40px rgba(0,229,255,0.08)",
              animation: "hud-pulse 2.4s ease-in-out infinite",
            }}
          >
            ENGAGE
          </button>
        </div>
      )}
    </div>
  );
}
