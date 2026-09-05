import type { ReactNode } from "react";
import { useUIStore } from "@/lib/store";

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

/** Initials avatar for a member, colored by their avatar_color (falls back to
 *  cyan for unassigned so cards always render a consistent-size chip). */
export function Avatar({
  name,
  color,
  size = 20,
}: {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
}) {
  const initials = name
    ? name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";
  const c = color || "#6B7280";
  return (
    <span
      title={name ?? "Unassigned"}
      style={{ width: size, height: size, background: `${c}26`, border: `1px solid ${c}66`, color: c }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
    >
      {initials}
    </span>
  );
}

/** Simple done/total progress bar, used for epic/initiative child rollups. */
export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--glass-border-2)]">
        <div className="h-full rounded-full bg-[var(--indigo)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-[var(--muted-hi)]">
        {value}/{total}
      </span>
    </div>
  );
}

export type LineageEntry = {
  key: string;
  label: string;
  current?: boolean;
  /** Present on non-current entries so the key can link to that work item's drawer. */
  type?: "ticket" | "epic" | "initiative";
};

/** A work item's key (e.g. "ENG-42"), clickable to open that item's drawer —
 *  works across tabs/builds and regardless of archived status, since it
 *  stashes an openWorkItem request on the UI store rather than depending on
 *  the item already being in scope locally (see Kanban/EpicsBoard/
 *  InitiativesBoard's openWorkItem effect). */
export function WorkItemKeyLink({
  itemKey,
  type,
  className = "font-mono text-[11px] font-semibold text-[var(--indigo-bright)] hover:underline",
}: {
  itemKey: string;
  type: "ticket" | "epic" | "initiative";
  className?: string;
}) {
  const setOpenWorkItem = useUIStore((s) => s.setOpenWorkItem);
  return (
    <button onClick={() => setOpenWorkItem({ type, key: itemKey })} className={className}>
      {itemKey}
    </button>
  );
}

/** Breadcrumb trail shown atop a ticket/epic/initiative drawer, tracing
 *  upstream ancestry (initiative › epic › ticket) with the current item bold.
 *  Non-current entries are clickable via WorkItemKeyLink. */
export function Lineage({ trail }: { trail: LineageEntry[] }) {
  if (trail.length <= 1) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
      {trail.map((t, i) => (
        <span key={t.key} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--muted-hi)]">›</span>}
          <span className={t.current ? "text-[var(--white)]" : "text-[var(--muted-hi)]"}>
            {!t.current && t.type ? (
              <WorkItemKeyLink itemKey={t.key} type={t.type} />
            ) : (
              <span className="font-mono text-[11px] font-semibold text-[var(--indigo-bright)]">{t.key}</span>
            )}{" "}
            {t.label}
          </span>
        </span>
      ))}
    </div>
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
