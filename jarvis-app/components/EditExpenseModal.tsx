"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { EXPENSE_CATEGORIES } from "@/components/NewExpenseModal";
import type { Tables } from "@/lib/database.types";

/** Edit one logged expense. Mounted only while a row is selected (keyed by id),
 *  so the form state is always seeded from the record being edited — same shape
 *  as BuildSettingsModal.
 *
 *  Recurring rows are templates: editing one changes every charge the ledger
 *  derives from it, including past ones. The date field is therefore labelled
 *  as the recurrence start when recurring, and kept in sync with spent_on so the
 *  row and its first charge never disagree. */
export function EditExpenseModal({
  expense,
  builds,
  onClose,
}: {
  expense: Tables<"expenses">;
  builds: Tables<"builds">[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [buildId, setBuildId] = useState(expense.build_id ?? "");
  const [vendor, setVendor] = useState(expense.vendor);
  const [amount, setAmount] = useState((expense.amount_cents / 100).toFixed(2));
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description ?? "");
  const [recurring, setRecurring] = useState(expense.is_recurring);
  const [cadence, setCadence] = useState<"monthly" | "annual">(
    expense.recurrence === "annual" ? "annual" : "monthly",
  );
  const [date, setDate] = useState(expense.effective_on ?? expense.spent_on);
  const [saving, setSaving] = useState(false);

  async function save() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!vendor.trim()) return toast.push("Vendor is required.", "error");
    if (!Number.isFinite(cents) || cents <= 0) return toast.push("Enter a valid amount.", "error");
    if (!date) return toast.push("Date is required.", "error");
    setSaving(true);
    const { error } = await supabase
      .from("expenses")
      .update({
        build_id: buildId || null,
        vendor: vendor.trim(),
        amount_cents: cents,
        category,
        description: description.trim() || null,
        is_recurring: recurring,
        recurrence: recurring ? cadence : null,
        // effective_on only means something for a recurrence; clear it when the
        // row is switched back to a one-off so the ledger stops expanding it.
        effective_on: recurring ? date : null,
        spent_on: date,
      })
      .eq("id", expense.id);
    setSaving(false);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["expenses"] });
    toast.push("Expense updated", "success");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${expense.vendor}`}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Build (blank = overhead)</label>
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
            <input className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Amount (USD)</label>
            <input
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!EXPENSE_CATEGORIES.includes(category) && <option value={category}>{category}</option>}
          </select>
        </div>
        <div>
          <label className={labelClass}>Description (optional)</label>
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Pro plan for the Woven staging env"
          />
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
        <div>
          <label className={labelClass}>{recurring ? "Effective date" : "Date"}</label>
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {recurring && (
            <p className="mt-1 text-xs text-[var(--muted-hi)]">
              Charges are listed {cadence === "annual" ? "annually" : "monthly"} from this date up to today.
            </p>
          )}
        </div>
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
