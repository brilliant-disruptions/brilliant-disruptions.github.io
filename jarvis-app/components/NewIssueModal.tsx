"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

const TYPES = ["bug", "feature", "perf", "security", "ux", "infra", "chore"];
const PRIORITIES = ["critical", "high", "medium", "low"];

export function NewIssueModal({
  open,
  onClose,
  builds,
  defaultBuild,
}: {
  open: boolean;
  onClose: () => void;
  builds: Tables<"builds">[];
  defaultBuild: string; // build id | "all"
}) {
  const qc = useQueryClient();
  const initialBuild = defaultBuild !== "all" ? defaultBuild : (builds[0]?.id ?? "");
  const [buildId, setBuildId] = useState(initialBuild);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("feature");
  const [priority, setPriority] = useState("medium");
  const [isBlocker, setIsBlocker] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!buildId) return setErr("Select a build.");
    if (!title.trim()) return setErr("Title is required.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("tickets").insert({
      build_id: buildId,
      title: title.trim(),
      type,
      priority,
      is_blocker: isBlocker,
      stage: "backlog",
      source: "manual",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    setTitle("");
    setIsBlocker(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New issue">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Build</label>
          <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            <option value="">— select —</option>
            {builds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
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
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create issue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
