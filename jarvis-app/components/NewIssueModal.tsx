"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, useTemplates, useWorkflowSwimlanes } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveSwimlanes } from "@/lib/board-constants";
import { scopeFilter } from "@/lib/scope";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import type { Tables } from "@/lib/database.types";

const TYPES = ["bug", "feature", "perf", "security", "ux", "infra", "chore"];
const PRIORITIES = ["critical", "high", "medium", "low"];

export function NewIssueModal({
  open,
  onClose,
  builds,
  defaultBuild,
  defaultEpicId,
}: {
  open: boolean;
  onClose: () => void;
  builds: Tables<"builds">[];
  defaultBuild: string; // build id | "all"
  defaultEpicId?: string;
}) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const initialBuild = defaultBuild !== "all" ? defaultBuild : (builds[0]?.id ?? "");
  const [buildId, setBuildId] = useState(initialBuild);
  const swimlanesQ = useWorkflowSwimlanes();
  const lanes = resolveSwimlanes(swimlanesQ.data, buildId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("feature");
  const [priority, setPriority] = useState("medium");
  const [swimlane, setSwimlane] = useState("product");
  const [epicId, setEpicId] = useState(defaultEpicId ?? "");
  const [points, setPoints] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [isBlocker, setIsBlocker] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Scoped to this modal's own build selection, not the page-level active-build
  // filter — otherwise switching the Build dropdown here wouldn't show that
  // build's epics whenever the global filter points at a different build.
  const epics = useQuery({
    queryKey: ["epics", "for-build", buildId || null],
    queryFn: async () => {
      const { data, error } = await scopeFilter(supabase.from("epics").select("*"), buildId || null).order(
        "sort_order",
      );
      if (error) throw error;
      return data as Tables<"epics">[];
    },
  });

  const template =
    templates.data?.find((t) => t.build_id === buildId && t.item_type === "ticket") ??
    templates.data?.find((t) => t.build_id === null && t.item_type === "ticket");

  async function submit() {
    if (!title.trim()) return setErr("Title is required.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("tickets").insert({
      build_id: buildId || null,
      title: title.trim(),
      description: description.trim() || null,
      type,
      priority,
      swimlane,
      epic_id: epicId || null,
      points: points ? Number(points) : null,
      custom_fields: customFields as never,
      is_blocker: isBlocker,
      stage: "backlog",
      source: "manual",
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    setTitle("");
    setDescription("");
    setPoints("");
    setCustomFields({});
    setIsBlocker(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="New issue">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Build</label>
          <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            <option value="">— No build —</option>
            {builds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass}>Description (optional)</label>
          <textarea
            className={inputClass + " min-h-[80px] resize-y"}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, repro steps, acceptance criteria…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Swimlane</label>
            <select className={inputClass} value={swimlane} onChange={(e) => setSwimlane(e.target.value)}>
              {lanes.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.icon} {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Epic (optional)</label>
            <select className={inputClass} value={epicId} onChange={(e) => setEpicId(e.target.value)}>
              <option value="">— none —</option>
              {(epics.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Points (optional)</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </div>
        {template && template.fields && (template.fields as unknown[]).length > 0 && (
          <CustomFieldsEditor fields={template.fields as never} values={customFields} onChange={setCustomFields} />
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
          <input type="checkbox" checked={isBlocker} onChange={(e) => setIsBlocker(e.target.checked)} />
          Launch blocker
        </label>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create issue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
