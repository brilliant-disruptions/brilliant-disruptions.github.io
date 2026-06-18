"use client";

/**
 * JARVIS Neural Interface — a member-gated, full-screen visual experience.
 *
 * Speech input is disabled for now. Instead, a single "Hi, I'm JARVIS" button
 * makes the Three.js neuron brain erupt in bright, color-cycling motion while
 * JARVIS speaks a greeting aloud. Renders as a `fixed inset-0 z-50` overlay
 * over the dashboard chrome, with a back link to the console.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeuralScene } from "@/lib/neural/scene";

const GREETING = "Hello. I'm JARVIS — the Brilliant Disruptions neural interface.";

export default function NeuralPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NeuralScene | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const boundaryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const synthUnlockedRef = useRef(false);

  const [active, setActive] = useState(false);
  const [webglOk, setWebglOk] = useState(true);

  // ─── Three.js scene lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new NeuralScene(canvasRef.current);
    const ok = scene.init();
    sceneRef.current = scene;
    setWebglOk(ok);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ─── Speech synthesis ──────────────────────────────────────────────────────
  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Refined British-male voices that read closest to JARVIS, best first.
    const PREFERRED = [
      "Microsoft Ryan Online (Natural) - English (United Kingdom)",
      "Google UK English Male",
      "Microsoft George - English (United Kingdom)",
      "Microsoft Ryan",
      "Microsoft George",
      "Arthur",
      "Daniel",
      "Oliver",
    ];
    for (const name of PREFERRED) {
      const lc = name.toLowerCase();
      const v =
        voices.find((vo) => vo.name === name) ||
        voices.find((vo) => vo.name.toLowerCase().includes(lc));
      if (v) return v;
    }
    const enGB = voices.filter((v) => /en[-_]GB/i.test(v.lang));
    const male = enGB.find((v) => /(male|daniel|george|ryan|arthur|oliver)/i.test(v.name));
    return male || enGB[0] || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
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
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        startBoundaryFallback(text);
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Calm, measured, slightly lowered — the JARVIS cadence.
      u.rate = 0.94;
      u.pitch = 0.88;
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
      const done = () => {
        speakingRef.current = false;
        stopBoundaryFallback();
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [pickVoice, startBoundaryFallback, stopBoundaryFallback],
  );

  // ─── Load synthesis voices (async in Chrome) ──────────────────────────────
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

  // Browsers (esp. Safari/iOS) only allow speech synthesis after a user
  // gesture. Prime it with a silent utterance on the first interaction.
  const unlockSynthesis = () => {
    if (synthUnlockedRef.current) return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    synthUnlockedRef.current = true;
  };

  const onGreet = () => {
    unlockSynthesis();
    setActive(true);
    sceneRef.current?.greet();
    speak(GREETING);
    // Re-enable the button once the burst settles.
    window.setTimeout(() => setActive(false), 5200);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[var(--void)] text-[var(--white)]">
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

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-10">
        <header className="flex items-center justify-between">
          <Link
            href="/overview"
            className="pointer-events-auto font-mono text-xs tracking-widest text-[var(--muted-hi)] transition hover:text-[var(--cyan)]"
          >
            ← CONSOLE
          </Link>
        </header>

        <div className="flex-1" />

        <footer className="flex flex-col items-center gap-4">
          <button
            onClick={onGreet}
            disabled={active}
            className="pointer-events-auto rounded-full border px-8 py-4 font-display text-base font-medium tracking-wide backdrop-blur transition disabled:opacity-70"
            style={{
              background: "var(--glass)",
              borderColor: active ? "var(--magenta)" : "var(--cyan)",
              color: "var(--white)",
              boxShadow: active
                ? "0 0 36px rgba(255,0,110,0.5), 0 0 80px rgba(124,58,237,0.35)"
                : "0 0 24px rgba(0,229,255,0.35)",
            }}
          >
            {active ? "JARVIS online…" : "Hi, I'm JARVIS"}
          </button>
        </footer>
      </div>
    </div>
  );
}
