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

// Resolve the JARVIS build that owns a repo ("owner/repo"). Null if untracked.
async function buildForRepo(fullName: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("builds")
    .select("id")
    .eq("github_repo", fullName)
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

// ── sync: reconcile open issues per tracked repo (§12.1) ──────────
async function runSync(): Promise<Json> {
  const { data: builds } = await supabase
    .from("builds")
    .select("id, github_repo")
    .eq("is_active", true)
    .not("github_repo", "is", null);

  let synced = 0;
  let status = "ok";
  let error: string | null = null;
  let activityWarn: string | null = null; // non-fatal backfill failure (degrades to 'partial')
  try {
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
  await emit({ type: "sync.completed", actor: "webhook:github", payload: { provider: "github", changes: synced } });
  return { synced, status };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);

    if (url.searchParams.get("sync") === "true") {
      // Sync is privileged; it's called by pg_cron/manual with a project JWT at
      // the gateway. No HMAC here (no GitHub payload to verify).
      return Response.json(await runSync());
    }

    // Webhook path: verify HMAC over the raw body.
    const raw = await req.text();
    const ok = await verifySignature(raw, req.headers.get("x-hub-signature-256"));
    if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });

    const ghEvent = req.headers.get("x-github-event") ?? "";
    const body = raw ? (JSON.parse(raw) as Json) : {};
    return Response.json(await handleWebhook(ghEvent, body));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
