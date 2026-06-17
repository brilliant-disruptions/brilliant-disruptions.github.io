"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { slugify, BUILD_PALETTE } from "@/lib/format";

const STAGES = ["concept", "spec", "building", "gtm", "launched", "paused", "killed"];
const MODELS = ["saas", "retainer", "b2c_sub", "b2c_onetime", "none"];

export function NewBuildModal({
  open,
  onClose,
  existingCount,
}: {
  open: boolean;
  onClose: () => void;
  existingCount: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [stage, setStage] = useState("concept");
  const [model, setModel] = useState("none");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    const color = BUILD_PALETTE[existingCount % BUILD_PALETTE.length];
    const { error } = await supabase.from("builds").insert({
      name: name.trim(),
      slug: slugify(name),
      stage,
      revenue_model: model,
      color,
      sort_order: existingCount,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["builds"] });
    setName("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a build">
      <div className="space-y-3">
        <p className="text-xs text-[var(--muted-hi)]">
          A build is any product or initiative — code-backed or not. Manual
          builds work everywhere; code builds appear automatically once GitHub is
          connected.
        </p>
        <div>
          <label className={labelClass}>Name</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Stage</label>
            <select className={inputClass} value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Revenue model</label>
            <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
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
            {saving ? "Adding…" : "Add build"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
