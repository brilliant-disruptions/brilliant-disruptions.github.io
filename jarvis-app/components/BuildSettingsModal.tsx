"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useGithubRepos } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

const STAGES = ["concept", "spec", "building", "gtm", "launched", "paused", "killed"];
const MODELS = ["saas", "retainer", "b2c_sub", "b2c_onetime", "none"];
// Child tables that cascade-delete with a build (for the destructive-delete count).
const CHILD_TABLES = ["tickets", "expenses", "prospects", "feedback", "milestones"] as const;

/** Manage one build: edit fields, link it to a real GitHub repo (so issues +
 *  commits/PRs sync in), or hard-delete it. Delete cascades to all child rows,
 *  so it's guarded by a typed confirmation + a live count of what's attached. */
export function BuildSettingsModal({
  build,
  onClose,
}: {
  build: Tables<"builds">;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(build.name);
  const [stage, setStage] = useState(build.stage);
  const [model, setModel] = useState(build.revenue_model ?? "none");
  const [repo, setRepo] = useState(build.github_repo ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const [loadRepos, setLoadRepos] = useState(false);
  const repos = useGithubRepos(loadRepos);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  // Fetch attached-row counts once so the delete confirmation tells the truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        CHILD_TABLES.map(async (t) => {
          const { count } = await supabase
            .from(t)
            .select("id", { count: "exact", head: true })
            .eq("build_id", build.id);
          return [t, count ?? 0] as const;
        }),
      );
      if (!cancelled) setCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [build.id]);

  async function save() {
    if (!name.trim()) return toast.push("Name is required.", "error");
    // Skip a no-op write so it doesn't emit a spurious build.edited audit row.
    const unchanged =
      name.trim() === build.name &&
      stage === build.stage &&
      model === (build.revenue_model ?? "none") &&
      (repo.trim() || null) === (build.github_repo ?? null);
    if (unchanged) return onClose();
    setBusy("save");
    const { error } = await supabase
      .from("builds")
      .update({
        name: name.trim(),
        stage,
        revenue_model: model,
        github_repo: repo.trim() || null,
      })
      .eq("id", build.id);
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["builds"] });
    qc.invalidateQueries({ queryKey: ["repo_activity"] });
    toast.push("Build updated", "success");
    onClose();
  }

  async function del() {
    setBusy("delete");
    const { error } = await supabase.from("builds").delete().eq("id", build.id);
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries(); // builds + every build-scoped query
    toast.push(`Deleted ${build.name}`, "info");
    onClose();
  }

  const childTotal = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;

  return (
    <Modal open onClose={onClose} title={`Manage ${build.name}`}>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Stage</label>
            <select className={inputClass} value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Revenue model</label>
            <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* GitHub repo linking — pick from the real repos the token can see */}
        <div className="space-y-2 rounded-lg border border-[var(--glass-border)] p-3">
          <div className="flex items-center justify-between">
            <label className={labelClass}>GitHub repo</label>
            <button
              className="font-mono text-[10px] text-[var(--cyan)] hover:underline disabled:opacity-50"
              onClick={() => setLoadRepos(true)}
              disabled={repos.isFetching}
            >
              {repos.isFetching ? "loading…" : loadRepos ? "↻ reload" : "load my repos"}
            </button>
          </div>
          {loadRepos && (repos.data?.length ?? 0) > 0 ? (
            <select className={inputClass} value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">— not linked —</option>
              {(repo && !repos.data?.some((r) => r.full_name === repo)) && (
                <option value={repo}>{repo} (current)</option>
              )}
              {repos.data?.map((r) => (
                <option key={r.full_name} value={r.full_name}>
                  {r.full_name}
                  {r.private ? " (private)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo — or load your repos to pick"
            />
          )}
          {loadRepos && repos.isSuccess && (repos.data?.length ?? 0) === 0 && (
            <p className="font-mono text-[10px] text-[var(--muted)]">
              No repos returned — set a GitHub token in Connections first.
            </p>
          )}
          <p className="font-mono text-[10px] text-[var(--muted)]">
            Linked repos sync issues + commits/PRs into this build.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {!confirmDelete ? (
            <button className="text-xs text-[var(--danger)] hover:underline" onClick={() => setConfirmDelete(true)}>
              Delete build…
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className={ghostBtn} onClick={onClose}>
              Cancel
            </button>
            <button className={primaryBtn} onClick={save} disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {confirmDelete && (
          <div className="space-y-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3">
            <p className="text-sm text-[var(--white)]">
              Permanently delete <span className="font-semibold">{build.name}</span>
              {childTotal !== null && childTotal > 0 ? (
                <>
                  {" "}
                  and{" "}
                  <span className="font-semibold">
                    {CHILD_TABLES.filter((t) => (counts?.[t] ?? 0) > 0)
                      .map((t) => `${counts?.[t]} ${t}`)
                      .join(", ")}
                  </span>
                </>
              ) : (
                " (no attached records)"
              )}
              ? This cannot be undone.
            </p>
            <input
              className={inputClass}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="type DELETE to confirm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className={ghostBtn}
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmText("");
                }}
              >
                Keep build
              </button>
              <button
                className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                disabled={confirmText !== "DELETE" || busy === "delete"}
                onClick={del}
              >
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
