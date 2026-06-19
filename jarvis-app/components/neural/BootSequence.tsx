"use client";

/**
 * BootSequence — a ~2.5s cinematic power-on: concentric rings draw themselves
 * in, "INITIALIZING J.A.R.V.I.S." fades up with a filling progress bar, then the
 * whole overlay fades out and calls onComplete to reveal the live HUD.
 * Collapses to a near-instant reveal under prefers-reduced-motion.
 */

import { useEffect, useState } from "react";

const LINES = [
  "BOOTING NEURAL CORE",
  "CALIBRATING SYNAPTIC MESH",
  "ENGAGING ARC REACTOR",
  "J.A.R.V.I.S. ONLINE",
];

function ringStyle(circ: number, delay: number): React.CSSProperties {
  return {
    strokeDasharray: circ,
    animation: `hud-ring-draw 1.1s ease ${delay}s both`,
    ["--dash" as string]: String(circ),
  } as React.CSSProperties;
}

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [pct, setPct] = useState(0);
  const [line, setLine] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const total = reduce ? 400 : 2600;

    const progress = setInterval(() => setPct((p) => Math.min(100, p + (reduce ? 50 : 4))), total / 26);
    const lineId = setInterval(() => setLine((l) => Math.min(LINES.length - 1, l + 1)), total / LINES.length);
    const fade = setTimeout(() => setFading(true), total - 350);
    const done = setTimeout(onComplete, total);
    return () => {
      clearInterval(progress);
      clearInterval(lineId);
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [onComplete]);

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-[#04060a]"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 0.35s ease" }}
    >
      <div className="relative grid place-items-center" style={{ width: "min(70vmin,560px)", height: "min(70vmin,560px)" }}>
        <svg viewBox="0 0 400 400" width="100%" height="100%" className="absolute inset-0">
          <circle cx="200" cy="200" r="180" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeOpacity="0.85" style={ringStyle(2 * Math.PI * 180, 0)} />
          <circle cx="200" cy="200" r="150" fill="none" stroke="var(--gold)" strokeWidth="2" strokeOpacity="0.9" style={ringStyle(2 * Math.PI * 150, 0.25)} />
          <circle cx="200" cy="200" r="120" fill="none" stroke="var(--violet)" strokeWidth="1.5" strokeOpacity="0.7" style={ringStyle(2 * Math.PI * 120, 0.5)} />
          <circle cx="200" cy="200" r={70 + pct * 0.4} fill="var(--cyan)" opacity={pct / 600} />
        </svg>

        <div className="relative z-10 text-center">
          <div className="font-display text-2xl font-bold tracking-[0.4em] text-[var(--cyan)]" style={{ animation: "hud-fade-up 0.6s ease both" }}>
            INITIALIZING
          </div>
          <div className="mt-2 font-mono text-xs tracking-[0.3em] text-[var(--gold)]">{LINES[line]}</div>
          <div className="mx-auto mt-5 h-[3px] w-52 bg-white/10">
            <div className="h-full bg-[var(--cyan)] transition-all duration-100" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 font-mono text-[10px] tracking-[0.2em] text-[var(--muted-hi)]">{pct}%</div>
        </div>
      </div>
    </div>
  );
}
