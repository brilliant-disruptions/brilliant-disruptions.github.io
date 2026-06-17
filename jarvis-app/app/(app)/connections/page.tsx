"use client";

import { useConnections } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";

const TONE: Record<string, "green" | "amber" | "red" | "muted"> = {
  connected: "green",
  pending: "amber",
  error: "red",
  disconnected: "muted",
};

export default function ConnectionsPage() {
  const conns = useConnections();

  return (
    <div className="space-y-4">
      <SectionTitle>Integrations</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {conns.data?.map((c) => (
          <Card key={c.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-[var(--white)]">{c.display_name}</span>
              <Badge tone={TONE[c.status] ?? "muted"}>{c.status}</Badge>
            </div>
            <p className="text-xs text-[var(--muted-hi)]">{c.description}</p>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-[var(--muted)]">
                {c.sync_frequency ? `sync: ${c.sync_frequency}` : "—"}
              </span>
              <button
                disabled
                className="rounded-md border border-[var(--glass-border-2)] px-2 py-1 font-mono text-[10px] text-[var(--muted-hi)] opacity-60"
                title="Connecting integrations is Phase 2+"
              >
                {c.status === "connected" ? "Manage" : "Connect"}
              </button>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Connecting integrations (GitHub, Stripe, Mercury, Gmail…) is Phase 2+. Cards
        reflect default seed status.
      </p>
    </div>
  );
}
