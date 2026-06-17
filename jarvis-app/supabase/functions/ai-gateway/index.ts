// ai-gateway — the single Edge Function all AI features call (spec §13.3).
// Injects company facts + a CURRENT build snapshot (never a hardcoded product
// list), selects the model from env, calls Anthropic, tracks token cost.
// The API key never reaches the client.
//
// Auth: requires a valid member session (Authorization: Bearer <access_token>).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL_DEFAULT = Deno.env.get("ANTHROPIC_MODEL_DEFAULT") ?? "claude-sonnet-4-6";
const MODEL_HEAVY = Deno.env.get("ANTHROPIC_MODEL_HEAVY") ?? "claude-opus-4-8";

const COMPANY_CONTEXT = `JARVIS is the AI intelligence layer for Brilliant Disruptions, a software studio in Middle Tennessee that ships multiple products and initiatives in parallel. The current set of builds is dynamic — always read it from the live builds data injected below; never assume which products exist. The studio's stack baseline is Expo React Native, TypeScript, Supabase, Zustand, and TanStack Query (deviation requires justification). North star: pursue world-changing ideas grounded in real demand data; optimize ruthlessly for speed to revenue; no dabbling. Outreach voice: authentic, local, unpolished. Be a direct, brilliant co-founder. Answer-first, concise.`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  try {
    // Verify the caller is an authenticated active member.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser(token);
    if (!userData?.user) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders() });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: member } = await admin
      .from("members")
      .select("id, is_active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!member || !member.is_active) {
      return Response.json({ error: "not a member" }, { status: 403, headers: corsHeaders() });
    }

    const { prompt, heavy } = await req.json();
    if (!prompt) {
      return Response.json({ error: "prompt required" }, { status: 400, headers: corsHeaders() });
    }

    // Inject a compact, CURRENT snapshot of builds + key metrics (§13.3).
    const { data: builds } = await admin
      .from("builds")
      .select("name, stage, health_score, revenue_model, mrr_target_cents")
      .eq("is_active", true);
    const snapshot = JSON.stringify(builds ?? []);

    if (!ANTHROPIC_API_KEY) {
      return Response.json(
        {
          text: "AI gateway is not yet configured (ANTHROPIC_API_KEY unset). Connect Anthropic in Connections to enable the command bar and AI assists.",
          model: null,
          cost_cents: 0,
        },
        { headers: corsHeaders() },
      );
    }

    const model = heavy ? MODEL_HEAVY : MODEL_DEFAULT;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: `${COMPANY_CONTEXT}\n\nCURRENT BUILDS (live snapshot): ${snapshot}`,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "(no response)";
    const inTok = data?.usage?.input_tokens ?? 0;
    const outTok = data?.usage?.output_tokens ?? 0;
    // Rough cost estimate (Sonnet-ish): $3/M in, $15/M out.
    const costCents = Math.ceil((inTok * 0.0003 + outTok * 0.0015) / 10);

    return Response.json({ text, model, cost_cents: costCents }, { headers: corsHeaders() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders() });
  }
});
