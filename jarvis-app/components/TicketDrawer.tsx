"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { Badge } from "@/components/ui";
import type { Tables } from "@/lib/database.types";

const TYPES = ["bug", "feature", "perf", "security", "ux", "infra", "chore"];
const PRIORITIES = ["critical", "high", "medium", "low"];

const PRIORITY_TONE: Record<string, "red" | "amber" | "cyan" | "muted"> = {
  critical: "red",
  high: "amber",
  medium: "cyan",
  low: "muted",
};

/** View + edit a ticket's description, type, priority, and blocker flag. Stage
 *  is read-only here — it advances through the Kanban (advance_ticket RPC), which
 *  is the audited action surface. Edits are direct updates (RLS allows members). */
export function TicketDrawer({ ticket, onClose }: { ticket: Tables<"tickets">; onClose: () => void }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(ticket.description ?? "");
  const [type, setType] = useState(ticket.type ?? "feature");
  const [priority, setPriority] = useState(ticket.priority ?? "medium");
  const [isBlocker, setIsBlocker] = useState(ticket.is_blocker ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("tickets")
      .update({
        description: description.trim() || null,
        type,
        priority,
        is_blocker: isBlocker,
      })
      .eq("id", ticket.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={ticket.title}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PRIORITY_TONE[priority] ?? "muted"}>{priority}</Badge>
          <Badge tone="muted">{ticket.stage}</Badge>
          {ticket.ref && <Badge tone="cyan">{ticket.ref}</Badge>}
          {ticket.external_url && (
            <a
              href={ticket.external_url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-[var(--cyan)] hover:underline"
            >
              GitHub ↗
            </a>
          )}
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={inputClass + " min-h-[120px] resize-y"}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, repro steps, acceptance criteria…"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
          <input type="checkbox" checked={isBlocker} onChange={(e) => setIsBlocker(e.target.checked)} />
          Launch blocker
        </label>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
