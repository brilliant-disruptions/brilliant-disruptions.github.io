"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { CONTRIBUTION_KINDS } from "@/components/NewContributionModal";
import type { Tables } from "@/lib/database.types";

/** Edit one contribution. Mounted only while a row is selected (keyed by id) so
 *  state is seeded from that record.
 *
 *  `repayable` is derived from `kind` (cash/in_kind = equity, expense/loan =
 *  liability), exactly as on create — it is never edited directly, so changing
 *  the type can't leave the row's accounting treatment inconsistent. Marking a
 *  repayable contribution repaid is what clears it from the "owed back" total,
 *  so that date is editable here too. */
export function EditContributionModal({
  contribution,
  members,
  builds,
  onClose,
}: {
  contribution: Tables<"contributions">;
  members: Tables<"members">[];
  builds: Tables<"builds">[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [memberId, setMemberId] = useState(contribution.member_id);
  const [buildId, setBuildId] = useState(contribution.build_id ?? "");
  const [kind, setKind] = useState(contribution.kind);
  const [amount, setAmount] = useState((contribution.amount_cents / 100).toFixed(2));
  const [description, setDescription] = useState(contribution.description);
  const [contributedOn, setContributedOn] = useState(contribution.contributed_on);
  const [repaidOn, setRepaidOn] = useState(contribution.repaid_on ?? "");
  const [saving, setSaving] = useState(false);

  const repayable = CONTRIBUTION_KINDS.find((k) => k.value === kind)?.repayable ?? false;

  async function save() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!memberId) return toast.push("Select who contributed.", "error");
    if (!description.trim()) return toast.push("Describe what it was for.", "error");
    if (!Number.isFinite(cents) || cents <= 0) return toast.push("Enter a valid amount.", "error");
    if (!contributedOn) return toast.push("Date is required.", "error");
    setSaving(true);
    const { error } = await supabase
      .from("contributions")
      .update({
        member_id: memberId,
        build_id: buildId || null,
        kind,
        amount_cents: cents,
        description: description.trim(),
        contributed_on: contributedOn,
        repayable,
        // Equity can't be "repaid" — drop any stale date if the type changed.
        repaid_on: repayable ? repaidOn || null : null,
      })
      .eq("id", contribution.id);
    setSaving(false);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["contributions"] });
    toast.push("Contribution updated", "success");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Edit contribution">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Contributor</label>
            <select className={inputClass} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Select…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Build (blank = studio)</label>
            <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
              <option value="">Studio / overhead</option>
              {builds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Type</label>
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {CONTRIBUTION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Amount (USD)</label>
            <input
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <input
              className={inputClass}
              type="date"
              value={contributedOn}
              onChange={(e) => setContributedOn(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>What was it for?</label>
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {repayable && (
          <div>
            <label className={labelClass}>Repaid on (blank = still owed)</label>
            <input
              className={inputClass}
              type="date"
              value={repaidOn}
              onChange={(e) => setRepaidOn(e.target.value)}
            />
          </div>
        )}
        <p className="text-xs text-[var(--muted-hi)]">
          {repayable
            ? "Recorded as reimbursable — the company owes this back."
            : "Recorded as owner's equity — capital contributed, not repayable."}
        </p>
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
