"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useUIStore } from "@/lib/store";
import { signOut } from "@/app/(app)/actions";
import { SyncDot } from "@/components/SyncDot";

type BuildLite = {
  id: string;
  name: string;
  slug: string;
  color: string;
  stage: string;
  health_score: number;
};
type MemberLite = {
  handle: string;
  full_name: string;
  avatar_color: string | null;
  role: string;
};

const TABS = [
  ["Overview", "/overview"],
  ["Engineering", "/engineering"],
  ["FinOps", "/finops"],
  ["Growth", "/growth"],
  ["Customers", "/customers"],
  ["Agents", "/agents"],
  ["Forecast", "/forecast"],
  ["Connections", "/connections"],
  ["Activity", "/activity"],
  ["Rules", "/rules"],
] as const;

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-xs text-[var(--muted-hi)] tabular-nums">{now}</span>;
}

export function TopBar({
  member,
  builds,
  pulse,
}: {
  member: MemberLite;
  builds: BuildLite[];
  pulse: string | null;
}) {
  const { activeBuild, setActiveBuild } = useUIStore();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--glass-border)] bg-[var(--void-2)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link href="/overview" className="font-display text-lg font-bold tracking-tight text-[var(--cyan)]">
          JARVIS
        </Link>
        <span className="font-mono text-[10px] text-[var(--muted)]">
          v{process.env.NEXT_PUBLIC_JARVIS_VERSION ?? "0.1.0"}
        </span>

        {/* Build selector — scopes the whole app */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <BuildPill
            label="ALL BUILDS"
            active={activeBuild === "all"}
            onClick={() => setActiveBuild("all")}
          />
          {builds.map((b) => (
            <BuildPill
              key={b.id}
              label={b.name}
              color={b.color}
              active={activeBuild === b.id}
              onClick={() => setActiveBuild(b.id)}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {pulse && (
            <span className="hidden max-w-[280px] truncate text-xs text-[var(--muted-hi)] lg:inline">
              <span className="text-[var(--cyan)]">PULSE</span> · {pulse}
            </span>
          )}
          <SyncDot />
          <Clock />
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-black"
              style={{ background: member.avatar_color ?? "var(--cyan)" }}
              title={`${member.full_name} (${member.role})`}
            >
              {member.handle.slice(0, 2).toUpperCase()}
            </span>
            <form action={signOut}>
              <button className="font-mono text-[10px] uppercase text-[var(--muted-hi)] hover:text-[var(--white)]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map(([label, href]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? "border-[var(--cyan)] text-[var(--white)]"
                  : "border-transparent text-[var(--muted-hi)] hover:text-[var(--white)]"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function BuildPill({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? "border-[var(--cyan)] bg-[var(--cyan)]/10 text-[var(--white)]"
          : "border-[var(--glass-border)] text-[var(--muted-hi)] hover:text-[var(--white)]"
      }`}
    >
      {color && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {label}
    </button>
  );
}
