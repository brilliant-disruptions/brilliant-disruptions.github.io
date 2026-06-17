"use client";

import { useRules } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, Tag } from "@/components/ui";

type ActionSpec = { type: string };

export default function RulesPage() {
  const rules = useRules();

  return (
    <div className="space-y-4">
      <SectionTitle>Rules Engine</SectionTitle>
      <p className="text-xs text-[var(--muted)]">
        Events match rules by trigger + conditions; matched rules run their actions
        (gated when high-risk). Authoring rules from the UI is Phase 4 — this is the
        read view of the seeded starter set.
      </p>
      <div className="space-y-2">
        {rules.data?.map((r) => {
          const actions = (Array.isArray(r.actions) ? r.actions : []) as ActionSpec[];
          return (
            <Card key={r.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-semibold text-[var(--white)]">{r.name}</span>
                <Badge tone="cyan">{r.trigger_event}</Badge>
                {r.requires_approval && <Badge tone="amber">gated</Badge>}
                {!r.is_enabled && <Badge tone="muted">disabled</Badge>}
                <span className="ml-auto font-mono text-[10px] text-[var(--muted)]">
                  priority {r.priority}
                </span>
              </div>
              {r.description && <p className="text-xs text-[var(--muted-hi)]">{r.description}</p>}
              <div className="flex flex-wrap gap-1.5">
                {actions.map((a, i) => (
                  <Tag key={i}>{a.type}</Tag>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
