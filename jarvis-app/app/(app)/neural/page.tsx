"use client";

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

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeuralScene } from "@/lib/neural/scene";
import { HudSound } from "@/lib/neural/sound";
import { JarvisListener } from "@/lib/neural/listen";
import { MicAnalyser } from "@/lib/neural/mic-analyser";
import { matchIntent } from "@/lib/neural/intents";
import { THEMES } from "@/lib/neural/themes";
import { ThemeSwitcher } from "@/components/neural/ThemeSwitcher";

const GREETING = "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.";

export default function NeuralPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NeuralScene | null>(null);
  const soundRef = useRef<HudSound | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const boundaryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const synthUnlockedRef = useRef(false);
  const voiceRaf = useRef(0);
  const voiceSpike = useRef(0);
  const listenerRef = useRef<JarvisListener | null>(null);
  const micRef = useRef<MicAnalyser | null>(null);
  const listenSession = useRef(0);

  const [active, setActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [theme, setTheme] = useState(0);
  const [micState, setMicState] = useState<"idle" | "listening">("idle");
  const [micSupported, setMicSupported] = useState(false);

  // ─── Scene + sound lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new NeuralScene(canvasRef.current);
    const ok = scene.init();
    sceneRef.current = scene;
    setWebglOk(ok);
    soundRef.current = new HudSound();
    listenerRef.current = new JarvisListener();
    micRef.current = new MicAnalyser();
    setMicSupported(JarvisListener.isSupported());
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- counter ref, not a DOM node: the live value must be bumped so a getUserMedia still pending at unmount resolves into an already-dead session
      listenSession.current++;
      listenerRef.current?.stop();
      listenerRef.current = null;
      micRef.current?.stop();
      micRef.current = null;
      if (boundaryTimer.current) {
        clearInterval(boundaryTimer.current);
        boundaryTimer.current = null;
      }
      window.speechSynthesis?.cancel();
      if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
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
        voiceSpike.current = 0.55 + Math.random() * 0.3;
        if (elapsed >= est) stopBoundaryFallback();
      }, perPulse);
    },
    [stopBoundaryFallback],
  );

  // While speaking, feed the core a continuous voice envelope (a smooth shimmer
  // plus a punch on every word) so the magma surface swells like it's the one
  // talking. The browser won't expose the real TTS waveform, so this is a
  // believable synthesized envelope synced to the speech timing.
  const startVoiceEnvelope = useCallback(() => {
    if (voiceRaf.current) return;
    const loop = () => {
      voiceRaf.current = requestAnimationFrame(loop);
      voiceSpike.current *= 0.86; // per-word punches decay
      const t = performance.now() / 1000;
      const shimmer = 0.3 + 0.16 * Math.sin(t * 11) + 0.1 * Math.sin(t * 17.3 + 1);
      sceneRef.current?.setVoiceLevel(Math.min(1, shimmer * 0.55 + voiceSpike.current));
    };
    loop();
  }, []);
  const stopVoiceEnvelope = useCallback(() => {
    if (voiceRaf.current) cancelAnimationFrame(voiceRaf.current);
    voiceRaf.current = 0;
    voiceSpike.current = 0;
    sceneRef.current?.setVoiceLevel(0);
  }, []);

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

  // ─── Interactions ──────────────────────────────────────────────────────────
  const onThemeChange = (i: number) => {
    setTheme(i);
    sceneRef.current?.setTheme(i);
  };

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
    // SpeechRecognition manages its own capture. The session token handles
    // getUserMedia resolving after the listen already ended: a stale session's
    // levels are ignored and its late-arriving stream is stopped immediately.
    const session = ++listenSession.current;
    const mic = micRef.current;
    void mic?.start((level, peak) => {
      if (listenSession.current !== session) return;
      sceneRef.current?.setVoiceLevel(level * 0.8);
      if (peak) sceneRef.current?.pulse(1);
    }).then((ok) => {
      if (ok && listenSession.current !== session) mic.stop();
    });

    listenerRef.current?.start({
      onResult: (transcript) => {
        speak(matchIntent(transcript));
      },
      onEnd: () => {
        listenSession.current++;
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
    setActive(true);
    soundRef.current?.unlock(); // first user gesture unlocks audio
    soundRef.current?.powerUp();
    unlockSynthesis();
    sceneRef.current?.greet();
    speak(GREETING);
    window.setTimeout(() => setActive(false), 4500);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#04060a] text-[var(--white)]">
      {/* Canvas keeps pointer events — OrbitControls listens on it. */}
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

      {/* UI overlay — transparent to drags except its own controls. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-8">
        <header className="flex items-center justify-between">
          <Link
            href="/overview"
            className="pointer-events-auto font-mono text-xs tracking-widest text-[var(--muted-hi)] transition hover:text-[var(--cyan)]"
          >
            ← CONSOLE
          </Link>
        </header>

        <footer className="relative flex items-end">
          <ThemeSwitcher active={theme} onChange={onThemeChange} />
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
            <button
              onClick={onGreet}
              disabled={active || speaking || micState === "listening"}
              className="pointer-events-auto px-9 py-4 font-display text-base font-semibold tracking-wide backdrop-blur transition disabled:opacity-80"
              style={{
                clipPath:
                  "polygon(0 14px, 14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px))",
                background: active ? "rgba(255,179,71,0.14)" : "rgba(0,229,255,0.1)",
                border: `1.5px solid ${active ? "var(--gold)" : "var(--cyan)"}`,
                color: active ? "var(--gold-bright)" : "var(--white)",
                boxShadow: active ? "0 0 36px rgba(255,179,71,0.45)" : "0 0 24px rgba(0,229,255,0.3)",
              }}
            >
              {active ? "JARVIS ONLINE…" : "Hi, I'm JARVIS"}
            </button>
            {micSupported && (
              <button
                onClick={onMic}
                disabled={active || speaking}
                aria-label={micState === "listening" ? "Stop listening" : "Talk to JARVIS"}
                aria-pressed={micState === "listening"}
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
          </div>
        </footer>
      </div>
    </div>
  );
}
