// Shared secret resolver for edge functions (spec §9).
//
// Order: Vault (UI-managed, via the read_secret RPC) → process env fallback.
// The `vault` schema isn't PostgREST-exposed, so we CANNOT select it directly
// from supabase-js — we go through public.read_secret, which is granted to
// service_role only (migration 0013). Env fallback means a function behaves
// identically to before until a key is set in the UI, and a missing/failed RPC
// degrades to env instead of throwing.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

let _client: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_client) {
    _client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  }
  return _client;
}

// Cache within a single function invocation/instance — secrets change rarely and
// the read_secret round-trip shouldn't repeat per request.
const _cache = new Map<string, string>();

/** Resolve a secret by name (= its env var name = its Vault secret name).
 *  Returns "" when neither Vault nor env has it (callers already treat empty as
 *  "not configured" and degrade). */
export async function getSecret(name: string): Promise<string> {
  if (_cache.has(name)) return _cache.get(name)!;
  let value = "";
  try {
    const { data, error } = await admin().rpc("read_secret", { p_name: name });
    if (!error && typeof data === "string" && data) value = data;
  } catch {
    // RPC missing/not-yet-deployed → fall through to env.
  }
  if (!value) value = Deno.env.get(name) ?? "";
  if (value) _cache.set(name, value);
  return value;
}
