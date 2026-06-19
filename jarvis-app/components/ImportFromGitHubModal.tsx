"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useBuilds, useGithubRepos } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, primaryBtn, ghostBtn } from "@/components/Modal";
import { Badge, EmptyState } from "@/components/ui";
import { slugify, BUILD_PALETTE } from "@/lib/format";

/** Discover the org's real GitHub repos and import them as builds. Repos already
 *  linked to a build are marked; unlinked repos get a one-click Import that
 *  creates a build with github_repo set, so issues + commits/PRs start syncing. */
export function ImportFromGitHubModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const builds = useBuilds();
  const repos = useGithubRepos(true);
  const [busy, setBusy] = useState<string | null>(null);

  const linked = new Set((builds.data ?? []).map((b) => b.github_repo).filter(Boolean) as string[]);

  async function importRepo(fullName: string) {
    setBusy(fullName);
    const count = builds.data?.length ?? 0;
    const name = fullName.split("/").pop() ?? fullName;
    const { error } = await supabase.from("builds").insert({
      name,
      slug: slugify(fullName.replace("/", "-")),
      stage: "building",
      revenue_model: "none",
      color: BUILD_PALETTE[count % BUILD_PALETTE.length],
      sort_order: count,
      github_repo: fullName,
    });
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["builds"] });
    toast.push(`Imported ${name}`, "success");
  }

  return (
    <Modal open onClose={onClose} title="Import from GitHub">
      <div className="space-y-3">
        {repos.isFetching ? (
          <p className="text-sm text-[var(--muted-hi)]">Loading your repos…</p>
        ) : repos.isError ? (
          <p className="text-sm text-[var(--danger)]">Couldn’t load repos: {String(repos.error)}</p>
        ) : (repos.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No repos found"
            hint="Set a GitHub token in Connections, then reopen this to see your repos."
          />
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {repos.data?.map((r) => {
              const isLinked = linked.has(r.full_name);
              return (
                <div
                  key={r.full_name}
                  className="flex items-center gap-2 rounded-lg border border-[var(--glass-border-2)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-[var(--white)]">{r.full_name}</span>
                      {r.private && <Badge tone="muted">private</Badge>}
                      {r.language && (
                        <span className="font-mono text-[10px] text-[var(--muted)]">{r.language}</span>
                      )}
                    </div>
                    {r.description && (
                      <p className="truncate text-[11px] text-[var(--muted-hi)]">{r.description}</p>
                    )}
                  </div>
                  {isLinked ? (
                    <Badge tone="green">linked</Badge>
                  ) : (
                    <button
                      className="shrink-0 rounded-md border border-[var(--glass-border-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted-hi)] transition hover:border-[var(--cyan)] hover:text-[var(--white)] disabled:opacity-50"
                      disabled={busy === r.full_name}
                      onClick={() => importRepo(r.full_name)}
                    >
                      {busy === r.full_name ? "importing…" : "import"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button className={ghostBtn} onClick={onClose}>
            Close
          </button>
          <button className={primaryBtn + " ml-2"} onClick={() => repos.refetch()} disabled={repos.isFetching}>
            Refresh
          </button>
        </div>
      </div>
    </Modal>
  );
}
