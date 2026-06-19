"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

const STATUSES = ["new", "sent", "engaged", "replied", "qualified", "call_booked", "won", "lost"];

/** Add a prospect by hand. The prospecting agent inserts the same shape from
 *  Maps once connected. Segment/location are free text — no hardcoded verticals
 *  (spec §4: the system must not embed a product/segment name in code). */
export function NewProspectModal({
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
  const [company, setCompany] = useState("");
  const [segment, setSegment] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("new");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!buildId) return setErr("Select a build.");
    if (!company.trim()) return setErr("Company is required.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("prospects").insert({
      build_id: buildId,
      company: company.trim(),
      segment: segment.trim() || null,
      contact_name: contactName.trim() || null,
      contact_email: contactEmail.trim() || null,
      location: location.trim() || null,
      status,
      notes: notes.trim() || null,
      source: "manual",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["prospects"] });
    setCompany("");
    setContactName("");
    setContactEmail("");
    setNotes("");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add prospect">
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
            <label className={labelClass}>Company</label>
            <input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelClass}>Segment (optional)</label>
            <input className={inputClass} value={segment} onChange={(e) => setSegment(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Contact name (optional)</label>
            <input className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Contact email (optional)</label>
            <input
              className={inputClass}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              inputMode="email"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Location (optional)</label>
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes (optional)</label>
          <textarea
            className={inputClass + " min-h-[60px] resize-y"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add prospect"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
