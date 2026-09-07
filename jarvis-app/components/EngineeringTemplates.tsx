"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useAllBuilds, useTemplates } from "@/lib/queries/hooks";
import { Card, SectionTitle } from "@/components/ui";
import { inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { FIELD_TYPES, type CustomField } from "@/lib/board-constants";
import { scopeFilter } from "@/lib/scope";
import type { Tables } from "@/lib/database.types";

const ITEM_TYPES = ["ticket", "epic", "initiative"] as const;

/** Lists every work_item_templates row (custom field definitions per build/item-type),
 *  each openable to edit in place and deletable. `buildId` only pre-selects the scope
 *  for creating a new row — the list itself always shows every row across all builds. */
export function EngineeringTemplates({ buildId }: { buildId: string | null }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const allBuilds = useAllBuilds();
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>("ticket");
  const [fields, setFields] = useState<CustomField[]>([]);
  const [saving, setSaving] = useState(false);

  function buildName(id: string | null) {
    if (id === null) return "Global";
    return allBuilds.data?.find((b) => b.id === id)?.name ?? id.slice(0, 8);
  }

  function openRow(row: Tables<"work_item_templates">) {
    setOpenId(row.id);
    setItemType(row.item_type as (typeof ITEM_TYPES)[number]);
    setFields((row.fields as CustomField[]) ?? []);
  }

  function openNew() {
    setOpenId("new");
    setItemType("ticket");
    setFields([]);
  }

  const hasPoints = fields.some((f) => f.key === "points");
  function togglePoints(enabled: boolean) {
    setFields((f) =>
      enabled ? [...f, { key: "points", label: "Points", type: "number" }] : f.filter((field) => field.key !== "points"),
    );
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

  async function save(scopeBuildId: string | null) {
    setSaving(true);
    const payload = { build_id: scopeBuildId, item_type: itemType, fields: fields as never };
    // Plain .upsert(onConflict: "build_id,item_type") can't resolve to an update
    // when build_id is null — Postgres's UNIQUE constraint never treats two NULLs
    // as conflicting, so a Global-scope save always inserted a duplicate row
    // instead of updating the existing one. Resolve the target row explicitly.
    let id = openId !== "new" ? openId : null;
    if (!id) {
      const { data: existing } = await scopeFilter(
        supabase.from("work_item_templates").select("id").eq("item_type", itemType),
        scopeBuildId,
      ).maybeSingle();
      id = existing?.id ?? null;
    }
    const { error } = id
      ? await supabase.from("work_item_templates").update(payload).eq("id", id)
      : await supabase.from("work_item_templates").insert(payload);
    setSaving(false);
    if (!error) {
      qc.invalidateQueries({ queryKey: ["work_item_templates"] });
      setOpenId(null);
    }
  }

  async function remove(row: Tables<"work_item_templates">) {
    if (!confirm(`Delete the ${buildName(row.build_id)} / ${row.item_type} custom-field template?`)) return;
    const { error } = await supabase.from("work_item_templates").delete().eq("id", row.id);
    if (!error) {
      qc.invalidateQueries({ queryKey: ["work_item_templates"] });
      if (openId === row.id) setOpenId(null);
    }
  }

  const editingRow = openId && openId !== "new" ? templates.data?.find((t) => t.id === openId) : null;
  const editingScopeBuildId = openId === "new" ? buildId : (editingRow?.build_id ?? null);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Custom-field templates</SectionTitle>
        <button className={ghostBtn} onClick={openNew}>
          + New template
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {(templates.data ?? []).length === 0 && (
          <p className="text-sm text-[var(--muted-hi)]">No custom-field templates yet.</p>
        )}
        {(templates.data ?? []).map((row) => (
          <div key={row.id} className="rounded-md border border-[var(--glass-border-2)] p-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--white)]">
                  {buildName(row.build_id)} · {row.item_type}
                </p>
                <p className="text-xs text-[var(--muted-hi)]">{((row.fields as CustomField[]) ?? []).length} fields</p>
              </div>
              <div className="flex gap-1">
                <button className={ghostBtn + " mb-0 px-2 py-1 text-xs"} onClick={() => (openId === row.id ? setOpenId(null) : openRow(row))}>
                  {openId === row.id ? "Close" : "Open"}
                </button>
                <button className={ghostBtn + " mb-0 px-2 py-1 text-xs"} onClick={() => remove(row)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {openId && (
        <div className="mt-4 border-t border-[var(--glass-border-2)] pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--white)]">
              {openId === "new" ? `New template (${buildName(buildId)})` : `Editing ${buildName(editingScopeBuildId ?? null)}`}
            </p>
            {openId === "new" && (
              <select
                className={inputClass + " mt-0 w-40"}
                value={itemType}
                onChange={(e) => setItemType(e.target.value as (typeof ITEM_TYPES)[number])}
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>

          {itemType === "ticket" && (
            <label className="mt-4 flex items-center gap-2 text-sm text-[var(--muted-hi)]">
              <input type="checkbox" checked={hasPoints} onChange={(e) => togglePoints(e.target.checked)} />
              Show points field on tickets
            </label>
          )}

          <div className="mt-4 space-y-2">
            {fields.filter((f) => f.key !== "points").length === 0 && (
              <p className="text-sm text-[var(--muted-hi)]">No custom fields for {itemType}s yet.</p>
            )}
            {fields.map((f, i) =>
              f.key === "points" ? null : (
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
              ),
            )}
          </div>

          <div className="mt-4 flex justify-between">
            <button className={ghostBtn} onClick={addField}>
              + Add field
            </button>
            <button className={primaryBtn} onClick={() => save(editingScopeBuildId ?? null)} disabled={saving}>
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
