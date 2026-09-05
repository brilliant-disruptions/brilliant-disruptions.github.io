"use client";

import { inputClass, labelClass } from "@/components/Modal";
import type { CustomField } from "@/lib/board-constants";

/** Renders one input per template-defined custom field, backed by a plain
 *  {key: value} record stored in the item's jsonb custom_fields column. */
export function CustomFieldsEditor({
  fields,
  values,
  onChange,
}: {
  fields: CustomField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  function set(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--glass-border-2)] p-3">
      <p className={labelClass}>Custom fields</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => {
          const val = values[f.key];
          if (f.type === "checkbox") {
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
                <input type="checkbox" checked={!!val} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
                {f.required && " *"}
              </label>
            );
          }
          if (f.type === "select") {
            return (
              <div key={f.key}>
                <label className={labelClass}>
                  {f.label}
                  {f.required && " *"}
                </label>
                <select
                  className={inputClass}
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">— select —</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={f.key}>
              <label className={labelClass}>
                {f.label}
                {f.required && " *"}
              </label>
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                className={inputClass}
                value={typeof val === "string" || typeof val === "number" ? val : ""}
                onChange={(e) => set(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
