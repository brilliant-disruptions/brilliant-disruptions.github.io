"use client";

import { useState } from "react";
import { useConnections } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { ConnectionModal } from "@/components/ConnectionModal";
import { timeAgo } from "@/lib/format";
import type { Tables } from "@/lib/database.types";

const TONE: Record<string, "green" | "amber" | "red" | "muted"> = {
  connected: "green",
  pending: "amber",
  error: "red",
  disconnected: "muted",
};

export default function ConnectionsPage() {
  const conns = useConnections();
  const [active, setActive] = useState<Tables<"connections"> | null>(null);

  return (
    <div className="space-y-4">
      <SectionTitle>Integrations</SectionTitle>
      <p className="text-xs text-[var(--muted)]">
        Connect a service by adding its API keys. Keys are stored server-side in
        Supabase Vault — they never reach the browser. Founders manage keys; any member
        can connect/disconnect and set sync cadence.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {conns.data?.map((c) => {
          const secrets = ((c.config as { secrets?: Record<string, unknown> } | null)?.secrets ?? {}) as Record<string, unknown>;
          const keyCount = Object.keys(secrets).length;
          return (
            <Card key={c.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-[var(--white)]">{c.display_name}</span>
                <Badge tone={TONE[c.status] ?? "muted"}>{c.status}</Badge>
              </div>
              <p className="text-xs text-[var(--muted-hi)]">{c.description}</p>
              <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--muted)]">
                <span>{c.sync_frequency ? `sync: ${c.sync_frequency}` : "—"}</span>
                {keyCount > 0 && <span className="text-[var(--success)]">· {keyCount} key{keyCount === 1 ? "" : "s"} set</span>}
                {c.last_sync_at && <span>· synced {timeAgo(c.last_sync_at)}</span>}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setActive(c)}
                  className="rounded-md border border-[var(--glass-border-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted-hi)] transition hover:border-[var(--cyan)] hover:text-[var(--white)]"
                >
                  {c.status === "connected" ? "Manage" : "Connect"}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {active && (
        <ConnectionModal open={!!active} onClose={() => setActive(null)} connection={active} />
      )}
    </div>
  );
}
