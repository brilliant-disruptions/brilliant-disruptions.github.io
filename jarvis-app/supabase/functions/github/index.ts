// github — the GitHub integration adapter (spec §12.1). Two jobs:
//   • Inbound webhook (GitHub → JARVIS): HMAC-verified, maps issue/deploy
//     events onto the JARVIS event bus (ticket.*, deploy.*).
//   • Sync (?sync=true): reconciles open issues per builds.github_repo to
//     cover any webhook the function missed (§6.3-B resilience, applied to GH).
//
// Deno runtime. Deploy with verify_jwt=false: GitHub sends X-Hub-Signature-256,
// not a Supabase JWT, so this function authenticates webhooks itself via HMAC.
// Outbound actions (close/comment/create issue) live in the event-processor's
// action layer — this function is inbound + reconcile only.
//
// Loop guard (§12.1): JARVIS closing an issue emits a GitHub webhook; we only
// emit ticket.advanced when the ticket isn't already in the target stage, so
// the round trip terminates instead of ping-ponging.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { detectFolderRenames, planReconcile, type ExistingBuild, type GhFile } from "./monorepo.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Json = Record<string, unknown>;

// Secrets resolve from the Vault (UI-managed) with an env fallback, so a token
// set in the Connections tab actually controls this adapter (spec §9).

// ── HMAC verification (§9: webhook endpoints verify signatures) ───
async function verifySignature(raw: string, header: string | null): Promise<boolean> {
  const webhookSecret = await getSecret("GITHUB_WEBHOOK_SECRET");
  if (!webhookSecret) return false; // fail closed: no secret configured = reject
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare.
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(header);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── GitHub REST helper (sync reads) ───────────────────────────────
async function gh(path: string): Promise<unknown> {
  const token = await getSecret("GITHUB_TOKEN"); // cached ~60s in getSecret
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jarvis-adapter",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json();
}

async function emit(event: Json): Promise<void> {
  await supabase.from("events").insert(event);
}

// Resolve the JARVIS build that owns a WHOLE repo ("owner/repo"). Null if
// untracked. github_path IS NULL excludes monorepo folder-builds: many share one
// github_repo, so without this guard .maybeSingle() would error on the apps repo.
async function buildForRepo(fullName: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("builds")
    .select("id")
    .eq("github_repo", fullName)
    .is("github_path", null)
    .eq("is_active", true)
    .maybeSingle();
  return data ?? null;
}

// ── map one issue onto a ticket (idempotent by external_id) ───────
// Returns 'created' | 'advanced' | 'noop' for the audit trail.
async function reconcileIssue(
  buildId: string,
  issue: { node_id: string; number: number; title: string; body: string | null; state: string; html_url: string },
): Promise<string> {
  const { data: existing } = await supabase
    .from("tickets")
    .select("id, stage")
    .eq("build_id", buildId)
    .eq("external_id", issue.node_id)
    .maybeSingle();

  const closed = issue.state === "closed";
  const ref = `#${issue.number}`;

  if (!existing) {
    // New issue → new ticket. Closed-on-arrival issues land in 'done'.
    const stage = closed ? "done" : "backlog";
    const { data: inserted } = await supabase
      .from("tickets")
      .insert({
        build_id: buildId,
        external_id: issue.node_id,
        external_url: issue.html_url,
        source: "github",
        ref,
        title: issue.title,
        description: issue.body,
        stage,
        stage_changed_at: new Date().toISOString(),
        closed_at: closed ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (inserted) {
      await emit({
        type: "ticket.created",
        build_id: buildId,
        actor: "webhook:github",
        entity_type: "ticket",
        entity_id: inserted.id,
        payload: { ticket: inserted },
      });
    }
    return "created";
  }

  // Existing ticket. Only act on a state change, and only forward — the loop
  // guard: if it's already done, a JARVIS-originated close just echoed back.
  const isDone = existing.stage === "done" || existing.stage === "archived";
  if (closed && !isDone) {
    const from = existing.stage;
    const { data: updated } = await supabase
      .from("tickets")
      .update({ stage: "done", stage_changed_at: new Date().toISOString(), closed_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();
    await emit({
      type: "ticket.advanced",
      build_id: buildId,
      actor: "webhook:github",
      entity_type: "ticket",
      entity_id: existing.id,
      payload: { from_stage: from, to_stage: "done", ticket: updated },
    });
    return "advanced";
  }
  if (!closed && isDone) {
    // Reopened upstream → regress to backlog (no auto-cascade rule today).
    const from = existing.stage;
    await supabase
      .from("tickets")
      .update({ stage: "backlog", stage_changed_at: new Date().toISOString(), closed_at: null })
      .eq("id", existing.id);
    await emit({
      type: "ticket.regressed",
      build_id: buildId,
      actor: "webhook:github",
      entity_type: "ticket",
      entity_id: existing.id,
      payload: { from_stage: from, to_stage: "backlog" },
    });
    return "advanced";
  }
  return "noop";
}

// ── repo_activity: recent commits + PRs for the Overview matrix (§12.1) ──
// Upsert by external_id so a webhook and a later ?sync= backfill don't dup, and
// a PR row updates (open → merged) instead of inserting twice.
async function upsertActivity(rows: Json[]): Promise<void> {
  if (rows.length === 0) return;
  await supabase.from("repo_activity").upsert(rows, { onConflict: "external_id" });
}

// Handles BOTH shapes: the push-webhook commit ({id, message, timestamp,
// author:{name}, url}) and the REST /commits item ({sha, html_url, commit:{...}}).
function commitRow(buildId: string, c: Json): Json {
  const commit = (c.commit as Json) ?? {};
  const sha = (c.id ?? c.sha) as string;
  const msg = (((c.message as string) ?? (commit.message as string)) ?? "").split("\n")[0];
  const author =
    ((c.author as Json)?.name as string) ?? ((commit.author as Json)?.name as string) ?? null;
  const when = (c.timestamp as string) ?? ((commit.author as Json)?.date as string) ?? null;
  return {
    build_id: buildId,
    kind: "commit",
    external_id: sha,
    ref: sha ? sha.slice(0, 7) : null,
    title: msg || "(no message)",
    author,
    url: (c.html_url as string) ?? (c.url as string) ?? null,
    status: null,
    occurred_at: when ?? new Date().toISOString(),
  };
}

function prRow(buildId: string, pr: Json): Json {
  const merged = Boolean(pr.merged_at ?? pr.merged);
  return {
    build_id: buildId,
    kind: "pull_request",
    external_id: pr.node_id as string,
    ref: `#${pr.number}`,
    title: (pr.title as string) ?? "(untitled PR)",
    author: ((pr.user as Json)?.login as string) ?? null,
    url: (pr.html_url as string) ?? null,
    status: merged ? "merged" : ((pr.state as string) ?? null),
    occurred_at: (pr.updated_at as string) ?? new Date().toISOString(),
  };
}

// ── deployment_status → deploy.* (§12.1 maps deploy events) ───────
async function handleDeploymentStatus(buildId: string | null, body: Json): Promise<void> {
  const state = ((body.deployment_status as Json)?.state as string) ?? "";
  const type =
    state === "success" ? "deploy.succeeded" : state === "failure" || state === "error" ? "deploy.failed" : "deploy.started";
  await emit({
    type,
    build_id: buildId,
    actor: "webhook:github",
    entity_type: "deploy",
    payload: { state, environment: (body.deployment_status as Json)?.environment ?? null },
  });
}

// ── webhook dispatch ──────────────────────────────────────────────
async function handleWebhook(ghEvent: string, body: Json): Promise<Json> {
  const repo = (body.repository as Json)?.full_name as string | undefined;
  if (!repo) return { ignored: "no repository" };
  const build = await buildForRepo(repo);
  if (!build) return { ignored: `untracked repo ${repo}` };

  switch (ghEvent) {
    case "issues": {
      const action = body.action as string;
      if (!["opened", "reopened", "closed", "edited"].includes(action)) {
        return { ignored: `issues.${action}` };
      }
      const issue = body.issue as Json;
      if (action === "edited") {
        // Title/body sync only — no event (avoids loops on our own edits).
        await supabase
          .from("tickets")
          .update({ title: issue.title as string, description: (issue.body as string) ?? null })
          .eq("build_id", build.id)
          .eq("external_id", issue.node_id as string);
        return { synced: "issue edited" };
      }
      const result = await reconcileIssue(build.id, {
        node_id: issue.node_id as string,
        number: issue.number as number,
        title: issue.title as string,
        body: (issue.body as string) ?? null,
        state: issue.state as string,
        html_url: issue.html_url as string,
      });
      return { result };
    }
    case "deployment_status":
      await handleDeploymentStatus(build.id, body);
      return { result: "deploy event emitted" };
    case "push": {
      const commits = (body.commits as Json[]) ?? [];
      await upsertActivity(commits.map((c) => commitRow(build.id, c)));
      return { result: `recorded ${commits.length} commits` };
    }
    case "pull_request": {
      const pr = body.pull_request as Json | undefined;
      if (pr) await upsertActivity([prRow(build.id, pr)]);
      return { result: "pr recorded" };
    }
    default:
      // workflow_run, issue_comment, … — accepted but not yet mapped.
      // Returning 200 stops GitHub retrying.
      return { ignored: ghEvent };
  }
}

// ── monorepo discovery: surface each top-level folder of the apps repo as a
//    build, and follow folder renames (§12.1 "build discovery") ──────────────
// Folder color cycle — mirrors lib/format BUILD_PALETTE (can't import client lib
// into the Deno runtime, so it's duplicated here).
const FOLDER_PALETTE = ["#00e5ff", "#7c3aed", "#00ff88", "#ff006e", "#06b6d4", "#fbbf24"];

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// A folder name may slugify into one that's already taken; append -2, -3, …
function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = slugify(base) || "build";
  let n = 2;
  while (taken.has(slug)) slug = `${slugify(base) || "build"}-${n++}`;
  taken.add(slug);
  return slug;
}

type MonorepoResult = { created: number; renamed: number; archived: number; restored: number; warn: string | null };

async function runMonorepoSync(): Promise<MonorepoResult> {
  const result: MonorepoResult = { created: 0, renamed: 0, archived: 0, restored: 0, warn: null };

  const { data: conn } = await supabase
    .from("connections")
    .select("config")
    .eq("provider", "github")
    .maybeSingle();
  const config = (conn?.config ?? {}) as Json;
  const appsRepo = config.apps_repo as string | undefined;
  if (!appsRepo) return result; // no apps repo configured → nothing to discover

  const lastSha = (config.apps_repo_synced_sha as string | undefined) ?? null;

  // Current top-level folders + HEAD sha of the default branch.
  const head = (await gh(`/repos/${appsRepo}/commits?per_page=1`)) as Json[];
  const headSha = (head[0]?.sha as string) ?? null;
  const contents = (await gh(`/repos/${appsRepo}/contents`)) as Json[];
  const currentFolders = contents.filter((c) => c.type === "dir").map((c) => c.name as string);

  // Folder renames since the last sync (force-push/missing-base 404s → skip,
  // discovery still reconciles by folder set; renames just aren't followed).
  let folderRenames = new Map<string, string>();
  if (lastSha && headSha && lastSha !== headSha) {
    try {
      const cmp = (await gh(`/repos/${appsRepo}/compare/${lastSha}...${headSha}`)) as Json;
      folderRenames = detectFolderRenames(((cmp.files as GhFile[]) ?? []));
    } catch (e) {
      result.warn = `compare ${appsRepo} ${lastSha}..${headSha}: ${String(e)}`;
    }
  }

  const { data: existing } = await supabase
    .from("builds")
    .select("id, github_path, name, is_active")
    .eq("github_repo", appsRepo)
    .not("github_path", "is", null);
  const builds = (existing ?? []) as ExistingBuild[];

  const plan = planReconcile(currentFolders, builds, folderRenames);

  // Slugs already in use (any build) so new/renamed folder slugs stay unique.
  const { data: slugRows } = await supabase.from("builds").select("slug");
  const taken = new Set((slugRows ?? []).map((r) => r.slug as string));

  // Renames: keep the same build id (tickets/expenses intact); follow the folder
  // name only when it was never customized in Jarvis (renameName).
  for (const r of plan.renames) {
    const patch: Json = { github_path: r.to };
    if (r.renameName) {
      patch.name = r.to;
      patch.slug = uniqueSlug(r.to, taken);
    }
    await supabase.from("builds").update(patch).eq("id", r.id);
    await emit({
      type: "build.renamed",
      build_id: r.id,
      actor: "sync:github",
      entity_type: "build",
      entity_id: r.id,
      payload: { from: r.from, to: r.to, repo: appsRepo },
    });
    result.renamed++;
  }

  // Resurrect soft-deleted builds whose folder came back.
  for (const r of plan.resurrects) {
    await supabase.from("builds").update({ is_active: true }).eq("id", r.id);
    await emit({
      type: "build.restored",
      build_id: r.id,
      actor: "sync:github",
      entity_type: "build",
      entity_id: r.id,
      payload: { path: r.path, repo: appsRepo },
    });
    result.restored++;
  }

  // New folders → new builds. sort_order continues after the current count.
  const { count: buildCount } = await supabase
    .from("builds")
    .select("id", { count: "exact", head: true });
  let order = buildCount ?? 0;
  for (const folder of plan.creates) {
    const { data: inserted } = await supabase
      .from("builds")
      .insert({
        name: folder,
        slug: uniqueSlug(folder, taken),
        github_repo: appsRepo,
        github_path: folder,
        color: FOLDER_PALETTE[order % FOLDER_PALETTE.length],
        sort_order: order++,
      })
      .select("id")
      .single();
    if (inserted) {
      await emit({
        type: "build.created",
        build_id: inserted.id,
        actor: "sync:github",
        entity_type: "build",
        entity_id: inserted.id,
        payload: { path: folder, repo: appsRepo },
      });
      result.created++;
    }
  }

  // Vanished folders → soft-delete (never hard-delete: could be a transient API
  // blip, and tickets/expenses must survive a folder briefly disappearing).
  for (const a of plan.archives) {
    await supabase.from("builds").update({ is_active: false }).eq("id", a.id);
    await emit({
      type: "build.archived",
      build_id: a.id,
      actor: "sync:github",
      entity_type: "build",
      entity_id: a.id,
      payload: { path: a.path, repo: appsRepo, reason: "folder removed upstream" },
    });
    result.archived++;
  }

  // Advance the cursor so the next run's compare starts from here. Merge, don't
  // clobber, the rest of config (secret hints live there too).
  if (headSha && headSha !== lastSha) {
    await supabase
      .from("connections")
      .update({ config: { ...config, apps_repo_synced_sha: headSha } })
      .eq("provider", "github");
  }

  return result;
}

// ── sync: reconcile open issues per tracked repo (§12.1) ──────────
async function runSync(): Promise<Json> {
  // Whole-repo builds only (github_path IS NULL). Folder-builds share one repo
  // and are reconciled separately by runMonorepoSync — syncing them here would
  // fetch the apps repo N times and duplicate every issue across all folders.
  const { data: builds } = await supabase
    .from("builds")
    .select("id, github_repo")
    .eq("is_active", true)
    .is("github_path", null)
    .not("github_repo", "is", null);

  let synced = 0;
  let status = "ok";
  let error: string | null = null;
  let activityWarn: string | null = null; // non-fatal backfill failure (degrades to 'partial')
  let monorepo: MonorepoResult | null = null;
  try {
    // Discover/reconcile monorepo folder-builds first (best-effort: a failure
    // here must not abort whole-repo issue sync, so it's caught and degraded).
    try {
      monorepo = await runMonorepoSync();
      synced += monorepo.created + monorepo.renamed + monorepo.archived + monorepo.restored;
      if (monorepo.warn) activityWarn = monorepo.warn;
    } catch (e) {
      activityWarn = `monorepo discovery: ${String(e)}`;
      console.error("monorepo discovery failed:", String(e));
    }

    for (const b of builds ?? []) {
      // Pull recently-updated issues (open + closed) to catch missed webhooks.
      const issues = (await gh(`/repos/${b.github_repo}/issues?state=all&sort=updated&per_page=50`)) as Json[];
      for (const i of issues) {
        if ((i as Json).pull_request) continue; // the issues API also returns PRs
        await reconcileIssue(b.id, {
          node_id: i.node_id as string,
          number: i.number as number,
          title: i.title as string,
          body: (i.body as string) ?? null,
          state: i.state as string,
          html_url: i.html_url as string,
        });
        synced++;
      }

      // Backfill the commit/PR feed (best-effort: an empty repo 409s on /commits,
      // which must not abort issue reconciliation for other builds).
      try {
        const commits = (await gh(`/repos/${b.github_repo}/commits?per_page=20`)) as Json[];
        await upsertActivity(commits.map((c) => commitRow(b.id, c)));
        const pulls = (await gh(
          `/repos/${b.github_repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`,
        )) as Json[];
        await upsertActivity(pulls.map((p) => prRow(b.id, p)));
        synced += commits.length + pulls.length;
      } catch (e) {
        // Empty repos legitimately 409 on /commits; record it but don't claim a
        // clean sync (Rule 12: don't report 'ok' when a backfill actually failed).
        activityWarn = `${b.github_repo}: ${String(e)}`;
        console.error(`repo_activity sync for ${b.github_repo} failed:`, String(e));
      }
    }
  } catch (err) {
    status = "error";
    error = String(err);
  }

  // A backfill warning degrades an otherwise-clean run to 'partial' so the
  // Connections tab shows it wasn't fully successful.
  if (status === "ok" && activityWarn) status = "partial";

  await supabase
    .from("connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      status: status === "error" ? "error" : "connected",
    })
    .eq("provider", "github");

  if (status === "error") {
    await emit({ type: "sync.failed", actor: "webhook:github", payload: { provider: "github", error } });
    return { synced, status, error };
  }
  await emit({
    type: "sync.completed",
    actor: "webhook:github",
    payload: { provider: "github", changes: synced, monorepo },
  });
  return { synced, status, monorepo };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Verify the caller is an active member (for the UI repo picker). This endpoint
// returns repo names from a private org, so it must not be open like the webhook.
async function verifyMember(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return false;
  const { data } = await supabase.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return false;
  const { data: m } = await supabase.from("members").select("is_active").eq("id", uid).maybeSingle();
  return Boolean(m?.is_active);
}

// List repos the configured token can see, trimmed to what the UI needs.
async function listRepos(): Promise<Json[]> {
  const token = await getSecret("GITHUB_TOKEN");
  if (!token) return []; // not connected → empty list (UI shows a connect hint)
  const repos = (await gh(
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member",
  )) as Json[];
  return repos.map((r) => ({
    full_name: r.full_name,
    description: r.description ?? null,
    private: r.private ?? false,
    language: r.language ?? null,
    pushed_at: r.pushed_at ?? null,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    const url = new URL(req.url);

    if (url.searchParams.get("sync") === "true") {
      // Sync is privileged; it's called by pg_cron/manual with a project JWT at
      // the gateway. No HMAC here (no GitHub payload to verify).
      return Response.json(await runSync());
    }

    const raw = await req.text();

    // UI repo picker: POST { list_repos: true } from an authenticated member.
    let parsed: Json = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Json) : {};
    } catch {
      /* not JSON → fall through to the webhook (HMAC) path */
    }
    if (parsed.list_repos === true) {
      if (!(await verifyMember(req))) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders() });
      }
      return Response.json({ repos: await listRepos() }, { headers: corsHeaders() });
    }

    // Webhook path: verify HMAC over the raw body.
    const ok = await verifySignature(raw, req.headers.get("x-hub-signature-256"));
    if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });

    const ghEvent = req.headers.get("x-github-event") ?? "";
    const body = raw ? (JSON.parse(raw) as Json) : {};
    return Response.json(await handleWebhook(ghEvent, body));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders() });
  }
});
