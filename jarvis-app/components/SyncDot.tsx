"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Live realtime heartbeat indicator. Green when subscribed to Postgres CDC. */
export function SyncDot() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("heartbeat")
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <span className="flex items-center gap-1.5" title={connected ? "Realtime connected" : "Connecting…"}>
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-[var(--success)]" : "bg-[var(--warn)]"
        }`}
        style={connected ? { boxShadow: "0 0 8px var(--success)" } : undefined}
      />
      <span className="hidden font-mono text-[10px] uppercase text-[var(--muted-hi)] sm:inline">
        {connected ? "live" : "sync"}
      </span>
    </span>
  );
}
