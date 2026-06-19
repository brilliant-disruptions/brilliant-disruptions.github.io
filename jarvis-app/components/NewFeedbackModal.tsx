"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

const SOURCES = ["internal", "beta_user", "app_store", "email", "support"];
const KINDS = ["bug", "feature", "perf", "ux", "praise", "complaint"];
const SEVERITIES = ["critical", "high", "medium", "low"];
const SENTIMENTS = ["positive", "neutral", "negative"];

/** Log a piece of customer feedback by hand. Members can insert directly (RLS).
 *  Synced sources (app store, email) flow in via adapters with the same shape. */
export function NewFeedbackModal({
  open,
  onClose,
  builds,
  defaultBuild,
}: {
  open: boolean;
  onClose: () => void;
  builds: Tables<"builds">[];
  defaultBuild: string;
}) {
  const qc = useQueryClient();
  const initialBuild = defaultBuild !== "all" ? defaultBuild : (builds[0]?.id ?? "");
  const [buildId, setBuildId] = useState(initialBuild);
  const [source, setSource] = useState("internal");
  const [kind, setKind] = useState("feature");
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [sentiment, setSentiment] = useState("neutral");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!buildId) return setErr("Select a build.");
    if (!summary.trim()) return setErr("Summary is required.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("feedback").insert({
      build_id: buildId,
      source,
      kind,
      summary: summary.trim(),
      detail: detail.trim() || null,
      severity,
      sentiment,
      status: "open",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["feedback"] });
    setSummary("");
    setDetail("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add feedback">
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Source</label>
            <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Kind</label>
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Summary</label>
          <input className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass}>Detail (optional)</label>
          <textarea
            className={inputClass + " min-h-[80px] resize-y"}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Severity</label>
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Sentiment</label>
            <select className={inputClass} value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
              {SENTIMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add feedback"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
