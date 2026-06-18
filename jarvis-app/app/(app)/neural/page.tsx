"use client";

/**
 * JARVIS Neural Interface — a member-gated, full-screen voice experience.
 *
 * Speak (Web Speech API) → live transcript → a scripted intent engine picks a
 * reply → JARVIS speaks it back while a Three.js neuron brain reacts across
 * idle / listening / thinking / speaking states. No LLM call (scripted demo).
 *
 * Renders as a `fixed inset-0 z-50` overlay so it covers the dashboard chrome
 * (TopBar / CommandBar) for a fully immersive view, with a back link to the
 * console.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeuralScene, type NeuralState } from "@/lib/neural/scene";
import { MicAnalyser } from "@/lib/neural/mic-analyser";
import { matchIntent } from "@/lib/neural/intents";

const STATE_COLOR: Record<NeuralState, string> = {
  idle: "var(--cyan)",
  listening: "var(--cyan)",
  thinking: "var(--violet)",
  speaking: "var(--magenta)",
};

export default function NeuralPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NeuralScene | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const boundaryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const synthUnlockedRef = useRef(false);

  const [state, setState] = useState<NeuralState>("idle");
  const [listening, setListening] = useState(false);
  const [useTextInput, setUseTextInput] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [webglOk, setWebglOk] = useState(true);

  const drive = useCallback((next: NeuralState) => {
    setState(next);
    sceneRef.current?.setState(next);
  }, []);

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
    return (
      voices.find((v) => /en-GB/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      voices[0]
    );
  }, []);

  const stopBoundaryFallback = useCallback(() => {
    if (boundaryTimer.current) {
      clearInterval(boundaryTimer.current);
      boundaryTimer.current = null;
    }
  }, []);

  const startBoundaryFallback = useCallback((text: string) => {
    const perPulse = 180;
    const est = Math.max(1200, (text.length / 12) * 1000);
    let elapsed = 0;
    boundaryTimer.current = setInterval(() => {
      elapsed += perPulse;
      sceneRef.current?.pulse(2);
      sceneRef.current?.setAmplitude(0.5 + Math.random() * 0.4);
      if (elapsed >= est) stopBoundaryFallback();
    }, perPulse);
  }, [stopBoundaryFallback]);

  const finishSpeaking = useCallback(() => {
    speakingRef.current = false;
    stopBoundaryFallback();
    drive("idle");
  }, [drive, stopBoundaryFallback]);

  const speak = useCallback(
    (text: string) => {
      speakingRef.current = true;
      drive("speaking");

      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        startBoundaryFallback(text);
        setTimeout(finishSpeaking, Math.max(1500, (text.length / 12) * 1000));
        return;
      }

      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 0.9;
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
      u.onend = finishSpeaking;
      u.onerror = finishSpeaking;
      synth.speak(u);
    },
    [drive, finishSpeaking, pickVoice, startBoundaryFallback],
  );

  // ─── Think → speak handoff ─────────────────────────────────────────────────
  const handleUtterance = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      drive("thinking");
      const reply = matchIntent(trimmed);
      setTimeout(() => speak(reply), 650);
    },
    [drive, speak],
  );

  // ─── Speech recognition setup ──────────────────────────────────────────────
  useEffect(() => {
    const SR =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;
    if (!SR) {
      // Defer past the effect body so we don't setState synchronously on mount.
      queueMicrotask(() => setUseTextInput(true));
      return;
    }

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      drive("listening");
      // Tap the live mic so the brain pulses with the user's actual voice.
      const mic = new MicAnalyser();
      micRef.current = mic;
      void mic.start((level, peak) => {
        sceneRef.current?.setAmplitude(level);
        if (peak) sceneRef.current?.pulse(2);
      });
    };
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) handleUtterance(final);
    };
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setUseTextInput(true);
      }
    };
    recognition.onend = () => {
      setListening(false);
      micRef.current?.stop();
      micRef.current = null;
      if (!speakingRef.current) drive("idle");
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.abort();
      micRef.current?.stop();
      micRef.current = null;
      recognitionRef.current = null;
    };
  }, [drive, handleUtterance]);

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
  // gesture. Prime it with a silent utterance on the first mic tap.
  const unlockSynthesis = () => {
    if (synthUnlockedRef.current) return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    synthUnlockedRef.current = true;
  };

  const toggleListening = () => {
    unlockSynthesis();
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
    } else {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };

  const onTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockSynthesis();
    const value = textValue.trim();
    if (!value) return;
    setTextValue("");
    handleUtterance(value);
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
          <div
            className="font-mono text-xs uppercase tracking-[0.16em] transition-colors"
            style={{ color: STATE_COLOR[state], textShadow: `0 0 12px ${STATE_COLOR[state]}` }}
          >
            ● {state}
          </div>
        </header>

        {/* Voice-only: the brain carries the experience — no on-screen words. */}
        <div className="flex-1" />

        <footer className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-3">
            {!useTextInput && (
              <button
                onClick={toggleListening}
                aria-pressed={listening}
                aria-label="Activate microphone"
                className="pointer-events-auto grid h-[76px] w-[76px] place-items-center rounded-full border backdrop-blur transition"
                style={{
                  background: "var(--glass)",
                  borderColor: listening ? "var(--cyan)" : "var(--glass-border)",
                  boxShadow: listening
                    ? "0 0 30px var(--cyan), 0 0 70px rgba(0,229,255,0.4)"
                    : "none",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={listening ? "var(--cyan)" : "var(--white)"}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[30px] w-[30px]"
                  aria-hidden
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
            {useTextInput && (
              <form onSubmit={onTextSubmit} className="pointer-events-auto">
                <input
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  type="text"
                  placeholder="Type to JARVIS…"
                  autoComplete="off"
                  className="w-[min(420px,80vw)] rounded-lg border px-4 py-2.5 font-mono text-[13px] text-[var(--white)] outline-none"
                  style={{ background: "var(--glass)", borderColor: "var(--glass-border)" }}
                />
              </form>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
