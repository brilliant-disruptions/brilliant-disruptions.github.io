"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

// Accounting treatment of the contribution. cash/in_kind = owner's equity
// (non-repayable); expense/loan = the company owes it back (a liability).
const KINDS: { value: string; label: string; repayable: boolean }[] = [
  { value: "cash", label: "Cash injection (equity)", repayable: false },
  { value: "in_kind", label: "In-kind asset (equity)", repayable: false },
  { value: "expense", label: "Paid a business expense (reimbursable)", repayable: true },
  { value: "loan", label: "Loan to company (repayable)", repayable: true },
];

export function NewContributionModal({
  open,
  onClose,
  members,
  builds,
  defaultBuild,
}: {
  open: boolean;
  onClose: () => void;
  members: Tables<"members">[];
  builds: Tables<"builds">[];
  defaultBuild: string;
}) {
  const qc = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [buildId, setBuildId] = useState(defaultBuild !== "all" ? defaultBuild : "");
  const [kind, setKind] = useState("cash");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [contributedOn, setContributedOn] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const repayable = KINDS.find((k) => k.value === kind)?.repayable ?? false;

  async function submit() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!memberId) return setErr("Select who contributed.");
    if (!description.trim()) return setErr("Describe what it was for.");
    if (!Number.isFinite(cents) || cents <= 0) return setErr("Enter a valid amount.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("contributions").insert({
      member_id: memberId,
      build_id: buildId || null, // null = studio / overhead
      kind,
      amount_cents: cents,
      description: description.trim(),
      repayable,
      // Omit contributed_on when blank so the DB default (today) applies.
      ...(contributedOn ? { contributed_on: contributedOn } : {}),
      source: "manual",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["contributions"] });
    setAmount("");
    setDescription("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log contribution">
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
            {KINDS.map((k) => (
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
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={labelClass}>Date (blank = today)</label>
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
            placeholder="e.g. Seed cash, MacBook, AWS bill on personal card"
          />
        </div>
        <p className="text-xs text-[var(--muted-hi)]">
          {repayable
            ? "Recorded as reimbursable — the company owes this back."
            : "Recorded as owner's equity — capital contributed, not repayable."}
        </p>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Log contribution"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
