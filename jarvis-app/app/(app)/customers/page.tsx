"use client";

import { useFeedback } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";

const SENTIMENT_TONE: Record<string, "green" | "amber" | "red" | "muted"> = {
  positive: "green",
  neutral: "muted",
  negative: "red",
};

export default function CustomersPage() {
  const feedback = useFeedback();
  const rows = feedback.data ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle>Feedback</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState
          title="No feedback yet"
          hint="Customer feedback, beta reports, and app-store reviews land here, AI-tagged for sentiment and severity."
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
    </div>
  );
}
