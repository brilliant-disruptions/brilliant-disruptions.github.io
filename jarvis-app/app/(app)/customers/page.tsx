"use client";

import { useState } from "react";
import { useFeedback, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { NewFeedbackModal } from "@/components/NewFeedbackModal";
import { primaryBtn } from "@/components/Modal";

const SENTIMENT_TONE: Record<string, "green" | "amber" | "red" | "muted"> = {
  positive: "green",
  neutral: "muted",
  negative: "red",
};

export default function CustomersPage() {
  const feedback = useFeedback();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [open, setOpen] = useState(false);
  const rows = feedback.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Feedback</SectionTitle>
        <button className={primaryBtn} onClick={() => setOpen(true)}>
          + Add feedback
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Add feedback by hand here. Once connected, App Store reviews and support email sync into the same
        list — each item is AI-tagged for sentiment and severity.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          title="No feedback yet"
          hint="Customer feedback, beta reports, and app-store reviews land here, AI-tagged for sentiment and severity."
          action={
            <button className={primaryBtn} onClick={() => setOpen(true)}>
              + Add feedback
            </button>
          }
        />
      ) : (
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {rows.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <Badge tone="muted">{f.kind}</Badge>
              <span className="flex-1 text-sm text-[var(--white)]">{f.summary}</span>
              {f.severity && <Badge tone={f.severity === "critical" ? "red" : "amber"}>{f.severity}</Badge>}
              {f.sentiment && <Badge tone={SENTIMENT_TONE[f.sentiment] ?? "muted"}>{f.sentiment}</Badge>}
              <Badge tone="cyan">{f.status}</Badge>
            </div>
          ))}
        </Card>
      )}

      <NewFeedbackModal
        open={open}
        onClose={() => setOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />
    </div>
  );
}
