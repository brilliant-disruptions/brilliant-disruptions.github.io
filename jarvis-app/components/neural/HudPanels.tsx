"use client";

/**
 * HudPanels — a single VOICE · OUTPUT readout in the bottom-right corner with a
 * waveform that animates while JARVIS speaks. The other telemetry panels were
 * removed to keep the HUD clean and focused on the voice.
 */

const CLIP = "polygon(0 12px, 12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)";

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

export function HudPanels({ speaking = false }: { speaking?: boolean }) {
  const gold = "var(--gold)";
  const rows = [
    { k: "CHANNEL", v: "EN-GB" },
    { k: "SYNTH", v: speaking ? "SPEAKING" : "IDLE", bar: speaking ? 1 : 0.05 },
  ];
  return (
    <div
      className="absolute bottom-8 right-4 w-[210px] hud-flicker sm:right-8"
      style={{ clipPath: CLIP, background: "rgba(8,16,22,0.55)", backdropFilter: "blur(6px)" }}
    >
      <div style={{ borderLeft: `2px solid ${gold}` }} className="px-4 py-3">
        <div className="font-mono text-[10px] tracking-[0.18em]" style={{ color: gold }}>
          VOICE · OUTPUT
        </div>
        <div className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <div key={r.k}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[var(--muted-hi)]">{r.k}</span>
                <span className="font-mono text-[10px] text-[var(--white)]">{r.v}</span>
              </div>
              {r.bar != null && (
                <div className="mt-1 h-[3px] w-full bg-white/10">
                  <div className="h-full transition-all duration-700" style={{ width: `${Math.round(r.bar * 100)}%`, background: gold }} />
                </div>
              )}
            </div>
          ))}
          <Waveform speaking={speaking} color={speaking ? gold : "var(--muted-hi)"} />
        </div>
      </div>
    </div>
  );
}
