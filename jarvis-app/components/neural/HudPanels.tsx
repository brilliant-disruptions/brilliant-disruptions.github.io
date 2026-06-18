"use client";

/**
 * HudPanels — the four angled-corner telemetry panels in the HUD corners, plus
 * a small reactor gauge and a voice waveform that animates while JARVIS speaks.
 * Values drift on an interval to feel live; everything spikes when `active`.
 */

import { useEffect, useState } from "react";

const CLIP = "polygon(0 12px, 12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)";

type Row = { k: string; v: string; bar?: number };

function Panel({
  title,
  accent,
  corner,
  rows,
  children,
}: {
  title: string;
  accent: string;
  corner: "tl" | "tr" | "bl" | "br";
  rows?: Row[];
  children?: React.ReactNode;
}) {
  const pos =
    corner === "tl"
      ? "left-4 top-16 sm:left-8 sm:top-20"
      : corner === "tr"
        ? "right-4 top-16 sm:right-8 sm:top-20"
        : corner === "bl"
          ? "left-4 bottom-8 sm:left-8"
          : "right-4 bottom-8 sm:right-8";
  return (
    <div
      className={`absolute ${pos} w-[210px] hud-flicker`}
      style={{ clipPath: CLIP, background: "rgba(8,16,22,0.55)", backdropFilter: "blur(6px)" }}
    >
      <div style={{ borderLeft: `2px solid ${accent}` }} className="px-4 py-3">
        <div className="font-mono text-[10px] tracking-[0.18em]" style={{ color: accent }}>
          {title}
        </div>
        <div className="mt-2 space-y-1.5">
          {rows?.map((r) => (
            <div key={r.k}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[var(--muted-hi)]">{r.k}</span>
                <span className="font-mono text-[10px] text-[var(--white)]">{r.v}</span>
              </div>
              {r.bar != null && (
                <div className="mt-1 h-[3px] w-full bg-white/10">
                  <div
                    className="h-full transition-all duration-700"
                    style={{ width: `${Math.round(r.bar * 100)}%`, background: accent }}
                  />
                </div>
              )}
            </div>
          ))}
          {children}
        </div>
      </div>
    </div>
  );
}

function Gauge({ frac, color, label }: { frac: number; color: string; label: string }) {
  const R = 22;
  const circ = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-3 pt-1">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`}
          transform="rotate(-90 28 28)"
          style={{ transition: "stroke-dasharray 0.7s ease" }}
        />
        <text x="28" y="32" textAnchor="middle" className="font-mono" fontSize="13" fill="var(--white)">
          {Math.round(frac * 100)}
        </text>
      </svg>
      <span className="font-mono text-[10px] tracking-wider text-[var(--muted-hi)]">{label}</span>
    </div>
  );
}

function Waveform({ speaking, color }: { speaking: boolean; color: string }) {
  const bars = Array.from({ length: 28 });
  return (
    <div className="flex h-8 items-center gap-[3px] pt-2">
      {bars.map((_, i) => (
        <span
          key={i}
          className="inline-block w-[3px] rounded-full"
          style={{
            height: "100%",
            background: color,
            transformOrigin: "center",
            opacity: speaking ? 0.9 : 0.3,
            transform: speaking ? undefined : "scaleY(0.2)",
            animation: speaking ? `hud-wave ${0.5 + (i % 5) * 0.08}s ease-in-out ${i * 0.03}s infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}

export function HudPanels({ speaking = false, active = false }: { speaking?: boolean; active?: boolean }) {
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1400);
    const c = setInterval(
      () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })),
      1000,
    );
    return () => {
      clearInterval(id);
      clearInterval(c);
    };
  }, []);

  // Gentle drift so the readouts feel alive; spike when active.
  const j = (base: number, amp: number) => base + Math.sin(tick * 1.7 + base) * amp;
  const cyan = "var(--cyan)";
  const gold = "var(--gold)";

  return (
    <>
      <Panel
        title="NEURAL CORE"
        accent={cyan}
        corner="tl"
        rows={[
          { k: "STATUS", v: active ? "GREETING" : "ONLINE", bar: active ? 1 : 0.62 },
          { k: "NODES", v: "320", bar: 0.8 },
          { k: "SYNAPSES", v: active ? "1.4K" : `${(1.05 + j(0, 0.04)).toFixed(2)}K`, bar: active ? 0.95 : 0.55 },
        ]}
      />
      <Panel
        title="POWER · TELEMETRY"
        accent={gold}
        corner="tr"
        rows={[
          { k: "UPLINK", v: clock },
          { k: "ARC REACTOR", v: "100%", bar: 1 },
          { k: "PULSE RATE", v: active ? "8.4k/s" : `${(2.1 + j(1, 0.3)).toFixed(1)}k/s`, bar: active ? 0.92 : 0.32 },
          { k: "COHERENCE", v: active ? "98%" : `${Math.round(j(2, 4) + 71)}%`, bar: active ? 0.98 : 0.71 },
        ]}
      >
        <Gauge frac={active ? 1 : 0.78} color={gold} label="OUTPUT" />
      </Panel>
      <Panel
        title="DIAGNOSTICS"
        accent={cyan}
        corner="bl"
        rows={[
          { k: "LATENCY", v: `${Math.max(1, Math.round(3 + j(3, 1)))}ms`, bar: 0.12 },
          { k: "TEMP", v: `${Math.round(42 + j(4, 2))}°C`, bar: 0.42 },
          { k: "INTEGRITY", v: "100%", bar: 1 },
        ]}
      />
      <Panel
        title="VOICE · OUTPUT"
        accent={gold}
        corner="br"
        rows={[
          { k: "CHANNEL", v: "EN-GB" },
          { k: "SYNTH", v: speaking ? "SPEAKING" : "IDLE", bar: speaking ? 1 : 0.05 },
        ]}
      >
        <Waveform speaking={speaking} color={speaking ? gold : "var(--muted-hi)"} />
      </Panel>
    </>
  );
}
