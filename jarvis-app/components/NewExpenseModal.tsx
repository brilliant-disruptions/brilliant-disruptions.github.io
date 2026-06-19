"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

const CATEGORIES = [
  "infrastructure",
  "ai_api",
  "software_tools",
  "marketing_ads",
  "legal_accounting",
  "hardware",
  "contractor",
  "travel",
  "other",
];

export function NewExpenseModal({
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
  const [buildId, setBuildId] = useState(defaultBuild !== "all" ? defaultBuild : "");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("software_tools");
  const [recurring, setRecurring] = useState(false);
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!vendor.trim()) return setErr("Vendor is required.");
    if (!Number.isFinite(cents) || cents <= 0) return setErr("Enter a valid amount.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("expenses").insert({
      build_id: buildId || null, // null = shared/overhead
      vendor: vendor.trim(),
      amount_cents: cents,
      category,
      is_recurring: recurring,
      recurrence: recurring ? cadence : null,
      source: "manual",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["expenses"] });
    setVendor("");
    setAmount("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log expense">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Build (optional — blank = overhead)</label>
          <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            <option value="">Shared / overhead</option>
            {builds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Vendor</label>
            <input className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelClass}>Amount (USD)</label>
            <input
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Recurring
          </label>
          {recurring && (
            <select
              className={inputClass + " mt-0 w-32"}
              value={cadence}
              onChange={(e) => setCadence(e.target.value as "monthly" | "annual")}
              aria-label="Recurrence cadence"
            >
              <option value="monthly">monthly</option>
              <option value="annual">annual</option>
            </select>
          )}
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Log expense"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
