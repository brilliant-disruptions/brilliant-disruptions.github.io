"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRules, supabase } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, Tag } from "@/components/ui";
import { primaryBtn, ghostBtn } from "@/components/Modal";
import { RuleModal, type RuleRow } from "@/components/RuleModal";

type ActionSpec = { type: string };

export default function RulesPage() {
  const rules = useRules();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle(rule: RuleRow) {
    // Optimistic: flip is_enabled in cache, roll back on error.
    const prev = qc.getQueryData(["rules"]);
    qc.setQueryData(["rules"], (old: RuleRow[] | undefined) =>
      (old ?? []).map((r) => (r.id === rule.id ? { ...r, is_enabled: !r.is_enabled } : r)),
    );
    const { error } = await supabase.rpc("set_rule_enabled", {
      p_id: rule.id,
      p_enabled: !rule.is_enabled,
    });
    if (error) {
      qc.setQueryData(["rules"], prev);
    } else {
      qc.invalidateQueries({ queryKey: ["rules"] });
    }
  }

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(rule: RuleRow) {
    setEditing(rule);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Rules Engine</SectionTitle>
        <button className={primaryBtn} onClick={openNew}>
          + New rule
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Events match rules by trigger + conditions; matched rules run their actions in
        order. High-risk actions are always gated; medium-risk gate unless a rule opts
        into auto-approve.
      </p>
      <div className="space-y-2">
        {(rules.data as RuleRow[] | undefined)?.map((r) => {
          const actions = (Array.isArray(r.actions) ? r.actions : []) as ActionSpec[];
          return (
            <Card key={r.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-semibold text-[var(--white)]">{r.name}</span>
                <Badge tone="cyan">{r.trigger_event}</Badge>
                {r.requires_approval && <Badge tone="amber">gated</Badge>}
                {r.config?.auto_approve_medium && <Badge tone="green">auto-medium</Badge>}
                {!r.is_enabled && <Badge tone="muted">disabled</Badge>}
                <span className="ml-auto font-mono text-[10px] text-[var(--muted)]">
                  priority {r.priority}
                </span>
              </div>
              {r.description && <p className="text-xs text-[var(--muted-hi)]">{r.description}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                {actions.map((a, i) => (
                  <Tag key={i}>{a.type}</Tag>
                ))}
                <div className="ml-auto flex gap-2">
                  <button className={ghostBtn + " !px-2 !py-1 !text-xs"} onClick={() => toggle(r)}>
                    {r.is_enabled ? "Disable" : "Enable"}
                  </button>
                  <button className={ghostBtn + " !px-2 !py-1 !text-xs"} onClick={() => openEdit(r)}>
                    Edit
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {open && <RuleModal open={open} onClose={() => setOpen(false)} rule={editing} />}
    </div>
  );
}
