import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`glass rounded-xl border-[var(--glass-border)] p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-[var(--muted-hi)]">
      {children}
    </h2>
  );
}

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">
        {label}
      </span>
      <span className="font-display text-2xl font-bold text-[var(--white)] tabular-nums">
        {value}
      </span>
      {sub && <span className="text-xs text-[var(--muted-hi)]">{sub}</span>}
    </Card>
  );
}

const TONE: Record<string, string> = {
  cyan: "border-[var(--cyan)]/40 text-[var(--cyan)] bg-[var(--cyan)]/10",
  green: "border-[var(--success)]/40 text-[var(--success)] bg-[var(--success)]/10",
  amber: "border-[var(--warn)]/40 text-[var(--warn)] bg-[var(--warn)]/10",
  red: "border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger)]/10",
  muted: "border-[var(--glass-border-2)] text-[var(--muted-hi)] bg-transparent",
};

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-[var(--glass-border-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-hi)]">
      {children}
    </span>
  );
}

/** Deterministic ring showing a 0–100 health score. */
export function HealthRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 70 ? "var(--success)" : pct >= 40 ? "var(--warn)" : "var(--danger)";
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--glass-border-2)" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="rotate-90 fill-[var(--white)] font-mono text-xs"
        style={{ transformOrigin: "center" }}
      >
        {pct}
      </text>
    </svg>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="font-display text-base text-[var(--white)]">{title}</p>
      {hint && <p className="max-w-md text-sm text-[var(--muted-hi)]">{hint}</p>}
      {action}
    </Card>
  );
}
