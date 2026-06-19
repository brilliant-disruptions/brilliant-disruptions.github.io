"use client";

/**
 * HudRings — the rotating Iron Man reticle rings, tick marks, segmented gold
 * arcs, corner reticles and a radar sweep, drawn as one centered square SVG
 * overlay. Rotation is pure CSS (see globals.css .hud-rotate*). `active` brightens
 * and energizes everything during the greeting burst.
 */

const C = 300; // center of the 600x600 viewBox
const rad = (d: number) => (d * Math.PI) / 180;
const pol = (r: number, a: number): [number, number] => [C + r * Math.cos(rad(a)), C + r * Math.sin(rad(a))];

function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = pol(r, a0);
  const [x1, y1] = pol(r, a1);
  const large = (a1 - a0) % 360 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Reticle({ r, a, color }: { r: number; a: number; color: string }) {
  const [x, y] = pol(r, a);
  return (
    <g stroke={color} strokeWidth={1.4} fill="none" opacity={0.9}>
      <path d={`M${x - 11} ${y - 11} h-9 M${x - 11} ${y - 11} v-9`} />
      <path d={`M${x + 11} ${y + 11} h9 M${x + 11} ${y + 11} v9`} />
    </g>
  );
}

export function HudRings({ active = false }: { active?: boolean }) {
  const cyan = "var(--cyan)";
  const gold = "var(--gold)";
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const microTicks = Array.from({ length: 120 }, (_, i) => i * 3);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{
        width: "min(92vmin, 1000px)",
        height: "min(92vmin, 1000px)",
        filter: active ? "drop-shadow(0 0 14px rgba(255,179,71,0.35))" : "none",
        transition: "filter 0.6s ease",
        opacity: active ? 1 : 0.85,
      }}
    >
      <svg viewBox="0 0 600 600" width="100%" height="100%">
        {/* radar sweep */}
        <defs>
          <radialGradient id="sweepGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={cyan} stopOpacity={0} />
            <stop offset="100%" stopColor={cyan} stopOpacity={active ? 0.22 : 0.14} />
          </radialGradient>
        </defs>
        <g className="hud-rotate-fast" style={{ animationDuration: active ? "6s" : "14s" }}>
          <path d={`M${C} ${C} L${pol(250, -28)[0]} ${pol(250, -28)[1]} A250 250 0 0 1 ${pol(250, 0)[0]} ${pol(250, 0)[1]} Z`} fill="url(#sweepGrad)" />
        </g>

        {/* inner fast partial ring */}
        <g className="hud-rotate-fast" style={{ animationDuration: active ? "8s" : "18s" }}>
          <path d={arc(120, -90, 150)} fill="none" stroke={cyan} strokeWidth={2} strokeOpacity={0.95} strokeLinecap="round" />
          <circle cx={pol(120, -90)[0]} cy={pol(120, -90)[1]} r={3.5} fill={cyan} />
        </g>

        {/* tick ring */}
        <g stroke={cyan} strokeOpacity={0.45} strokeWidth={1} className="hud-rotate" style={{ animationDuration: active ? "30s" : "60s" }}>
          {ticks.map((a) => {
            const [x0, y0] = pol(150, a);
            const [x1, y1] = pol(156, a);
            return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} />;
          })}
        </g>

        {/* gold segmented arcs (counter-rotating) */}
        <g className="hud-rotate-rev" style={{ animationDuration: active ? "40s" : "90s" }}>
          <path d={arc(178, 10, 100)} fill="none" stroke={gold} strokeWidth={3} strokeOpacity={0.9} strokeLinecap="round" />
          <path d={arc(178, 190, 280)} fill="none" stroke={gold} strokeWidth={3} strokeOpacity={0.9} strokeLinecap="round" />
        </g>

        {/* violet / magenta secondary arcs (brand) */}
        <g className="hud-rotate" style={{ animationDuration: active ? "26s" : "70s" }}>
          <path d={arc(196, 120, 200)} fill="none" stroke="var(--violet)" strokeWidth={2} strokeOpacity={0.6} strokeLinecap="round" />
          <path d={arc(196, 250, 320)} fill="none" stroke="var(--magenta)" strokeWidth={2} strokeOpacity={0.6} strokeLinecap="round" />
        </g>

        {/* dashed outer ring + reticles */}
        <circle cx={C} cy={C} r={216} fill="none" stroke={cyan} strokeWidth={1} strokeOpacity={0.25} strokeDasharray="2 8" />
        {[0, 90, 180, 270].map((a) => (
          <Reticle key={a} r={216} a={a} color={gold} />
        ))}

        {/* micro tick ring */}
        <g stroke={cyan} strokeOpacity={0.22} strokeWidth={1} className="hud-rotate-rev" style={{ animationDuration: "120s" }}>
          {microTicks.map((a) => {
            const [x0, y0] = pol(236, a);
            const [x1, y1] = pol(240, a);
            return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} />;
          })}
        </g>
      </svg>
    </div>
  );
}
