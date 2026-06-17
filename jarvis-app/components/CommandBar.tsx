"use client";

import { useState } from "react";
import { supabase } from "@/lib/queries/hooks";

// Natural-language command bar (spec §10.5). Routes asks to the ai-gateway
// edge function, which injects company context + a live build snapshot.
export function CommandBar() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setLoading(true);
    setAnswer(null);
    setOpen(true);
    const { data, error } = await supabase.functions.invoke("ai-gateway", {
      body: { prompt: q.trim() },
    });
    setLoading(false);
    setAnswer(error ? `Error: ${error.message}` : (data?.text ?? "(no response)"));
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--glass-border)] bg-[var(--void-2)]/95 backdrop-blur">
      <div className="mx-auto max-w-[1600px] px-4 py-2 sm:px-6">
        {open && answer !== null && (
          <div className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[var(--elevated)] p-3 text-sm text-[var(--white)]">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase text-[var(--cyan)]">JARVIS</span>
              <button onClick={() => setOpen(false)} className="text-[var(--muted-hi)]">
                ✕
              </button>
            </div>
            <p className="whitespace-pre-wrap">{answer}</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--cyan)]">⌘</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ask JARVIS or issue a command…"
            className="flex-1 bg-transparent py-1.5 text-sm text-[var(--white)] outline-none placeholder:text-[var(--muted)]"
          />
          <button
            onClick={ask}
            disabled={loading}
            className="rounded-md border border-[var(--glass-border-2)] px-3 py-1 font-mono text-[10px] uppercase text-[var(--muted-hi)] hover:text-[var(--white)] disabled:opacity-50"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
