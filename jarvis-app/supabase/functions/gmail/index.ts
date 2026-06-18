// gmail — outreach signals adapter (spec §12.4). Sync-only here: reads open/
// reply signals for tracked prospects (gmail_thread_id) and maps them onto the
// event bus (prospect.replied, prospect.high_intent). The outbound actions
// (gmail.draft / gmail.send) live in the event-processor's action layer.
//
// Open tracking method: THREAD ACTIVITY — a thread that has an inbound message
// from the prospect counts as a reply; message count is a coarse engagement
// proxy. (Pixel tracking is out of scope for v1.)
//
// Deno runtime, invoked with `?sync=true`. Degrades safely: no Google OAuth
// refresh token → records sync state, emits sync.failed, never throws.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const REFRESH_TOKEN = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN") ?? "";
const HIGH_INTENT_OPENS = 3; // §6.1 prospect.high_intent heuristic

type Json = Record<string, unknown>;

async function emit(event: Json): Promise<void> {
  await supabase.from("events").insert(event);
}

async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token → ${res.status}`);
  return (await res.json()).access_token as string;
}

async function gmailGet(token: string, path: string): Promise<Json> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail ${path} → ${res.status}`);
  return res.json();
}

async function runSync(): Promise<Json> {
  if (!REFRESH_TOKEN) {
    await supabase
      .from("connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", status: "disconnected" })
      .eq("provider", "gmail");
    await emit({ type: "sync.failed", actor: "webhook:gmail", payload: { provider: "gmail", error: "no oauth token" } });
    return { status: "skipped", reason: "GOOGLE_OAUTH_REFRESH_TOKEN unset" };
  }

  let changes = 0;
  let status = "ok";
  let error: string | null = null;
  try {
    const token = await accessToken();
    const { data: prospects } = await supabase
      .from("prospects")
      .select("id, build_id, status, open_count, reply_count, contact_email, gmail_thread_id")
      .not("gmail_thread_id", "is", null);

    for (const p of prospects ?? []) {
      const thread = await gmailGet(token, `/threads/${p.gmail_thread_id}?format=metadata`);
      const messages = (thread.messages as Json[]) ?? [];
      // Inbound = a message whose From contains the prospect's email → a reply.
      const inbound = messages.filter((m) => {
        const headers = ((m.payload as Json)?.headers as Json[]) ?? [];
        const from = headers.find((h) => (h.name as string)?.toLowerCase() === "from");
        return p.contact_email && String(from?.value ?? "").includes(p.contact_email);
      });
      const opens = Math.max(p.open_count ?? 0, messages.length - 1); // coarse engagement proxy
      const replied = inbound.length > 0;

      const update: Json = { open_count: opens, reply_count: inbound.length, last_touch_at: new Date().toISOString() };
      if (replied && p.status !== "replied" && p.status !== "won" && p.status !== "lost") {
        update.status = "replied";
      }
      await supabase.from("prospects").update(update).eq("id", p.id);

      if (replied && p.reply_count === 0) {
        await emit({
          type: "prospect.status_changed",
          build_id: p.build_id,
          actor: "webhook:gmail",
          entity_type: "prospect",
          entity_id: p.id,
          payload: { from_status: p.status, to_status: "replied", prospect: { id: p.id } },
        });
        changes++;
      }
      if (opens >= HIGH_INTENT_OPENS && (p.open_count ?? 0) < HIGH_INTENT_OPENS) {
        await emit({
          type: "prospect.high_intent",
          build_id: p.build_id,
          actor: "webhook:gmail",
          entity_type: "prospect",
          entity_id: p.id,
          payload: { open_count: opens, prospect: { id: p.id } },
        });
        changes++;
      }
    }
  } catch (err) {
    status = "error";
    error = String(err);
  }

  await supabase
    .from("connections")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, status: status === "ok" ? "connected" : "error" })
    .eq("provider", "gmail");

  if (status === "error") {
    await emit({ type: "sync.failed", actor: "webhook:gmail", payload: { provider: "gmail", error } });
    return { status, error };
  }
  await emit({ type: "sync.completed", actor: "webhook:gmail", payload: { provider: "gmail", changes } });
  return { status, changes };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("sync") === "true") return Response.json(await runSync());
    return Response.json({ error: "use ?sync=true" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
