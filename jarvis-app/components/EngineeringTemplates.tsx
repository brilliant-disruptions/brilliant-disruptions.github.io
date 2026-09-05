"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useTemplates } from "@/lib/queries/hooks";
import { Card, SectionTitle } from "@/components/ui";
import { inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { FIELD_TYPES, type CustomField } from "@/lib/board-constants";

const ITEM_TYPES = ["ticket", "epic", "initiative"] as const;

/** Per-build custom-field templates. One row per (build, item_type); editing
 *  writes the whole `fields` array back — small tool, small table, no need
 *  for field-level CRUD endpoints. */
export function EngineeringTemplates({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>("ticket");

  const existing = templates.data?.find((t) => t.build_id === buildId && t.item_type === itemType);
  const [fields, setFields] = useState<CustomField[]>((existing?.fields as CustomField[]) ?? []);
  const [saving, setSaving] = useState(false);

  function syncFromExisting(type: (typeof ITEM_TYPES)[number]) {
    setItemType(type);
    const t = templates.data?.find((x) => x.build_id === buildId && x.item_type === type);
    setFields((t?.fields as CustomField[]) ?? []);
  }

  function addField() {
    setFields((f) => [...f, { key: `field_${f.length + 1}`, label: "New field", type: "text" }]);
  }
  function updateField(i: number, patch: Partial<CustomField>) {
    setFields((f) => f.map((field, idx) => (idx === i ? { ...field, ...patch } : field)));
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("work_item_templates")
      .upsert({ build_id: buildId, item_type: itemType, fields: fields as never }, { onConflict: "build_id,item_type" });
    setSaving(false);
    if (!error) qc.invalidateQueries({ queryKey: ["work_item_templates"] });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Custom fields</SectionTitle>
        <select
          className={inputClass + " mt-0 w-40"}
          value={itemType}
          onChange={(e) => syncFromExisting(e.target.value as (typeof ITEM_TYPES)[number])}
        >
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 space-y-2">
        {fields.length === 0 && <p className="text-sm text-[var(--muted-hi)]">No custom fields for {itemType}s yet.</p>}
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-2">
            <div>
              <label className={labelClass}>Key</label>
              <input className={inputClass} value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Label</label>
              <input className={inputClass} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select
                className={inputClass}
                value={f.type}
                onChange={(e) => updateField(i, { type: e.target.value as CustomField["type"] })}
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--muted-hi)]">
              <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
              req
            </label>
            <button className={ghostBtn + " mb-0"} onClick={() => removeField(i)}>
              Remove
            </button>
            {f.type === "select" && (
              <div className="col-span-5">
                <label className={labelClass}>Options (comma-separated)</label>
                <input
                  className={inputClass}
                  value={(f.options ?? []).join(", ")}
                  onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-between">
        <button className={ghostBtn} onClick={addField}>
          + Add field
        </button>
        <button className={primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save template"}
        </button>
      </div>
    </Card>
  );
}
