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

// Short TTL cache so the read_secret round-trip doesn't repeat per request, but
// a key rotated in the UI takes effect within a minute on a warm instance.
const TTL_MS = 60_000;
const _cache = new Map<string, { value: string; ts: number }>();

/** Resolve a secret by name (= its env var name = its Vault secret name).
 *  Returns "" when neither Vault nor env has it (callers already treat empty as
 *  "not configured" and degrade). */
export async function getSecret(name: string): Promise<string> {
  const hit = _cache.get(name);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.value;
  let value = "";
  try {
    const { data, error } = await admin().rpc("read_secret", { p_name: name });
    // Log a real failure: env fallback would otherwise mask a permission/deploy
    // misconfig as "not configured" forever.
    if (error) console.error(`read_secret(${name}) failed:`, error.message);
    else if (typeof data === "string" && data) value = data;
  } catch (err) {
    console.error(`read_secret(${name}) threw:`, String(err));
  }
  if (!value) value = Deno.env.get(name) ?? "";
  if (value) _cache.set(name, { value, ts: Date.now() });
  return value;
}
