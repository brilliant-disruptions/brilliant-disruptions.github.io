"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

// Per-provider secret fields. The `name` is the Vault secret name == the env var
// the adapter reads, so a UI-set key resolves by the same name. These are infra
// credential names, not product names.
const PROVIDER_KEYS: Record<string, { name: string; label: string }[]> = {
  github: [
    { name: "GITHUB_TOKEN", label: "Personal access token" },
    { name: "GITHUB_WEBHOOK_SECRET", label: "Webhook secret" },
  ],
  stripe: [
    { name: "STRIPE_SECRET_KEY", label: "Secret key" },
    { name: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret" },
  ],
  mercury: [{ name: "MERCURY_API_TOKEN", label: "API token" }],
  gmail: [
    { name: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth client ID" },
    { name: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth client secret" },
    { name: "GOOGLE_OAUTH_REFRESH_TOKEN", label: "OAuth refresh token" },
  ],
  maps: [{ name: "GOOGLE_MAPS_API_KEY", label: "API key" }],
  anthropic: [{ name: "ANTHROPIC_API_KEY", label: "API key" }],
  slack: [{ name: "SLACK_WEBHOOK_URL", label: "Incoming webhook URL" }],
  expo: [{ name: "EXPO_TOKEN", label: "Access token" }],
};

const SYNC_FREQ = ["realtime", "5m", "15m", "1h", "4h", "6h", "on_push"];

type SecretHints = Record<string, { last4?: string; set_at?: string }>;

/** Founders set integration secrets here. Each key is written to Supabase Vault
 *  via set_connection_secret — the plaintext never returns to the browser; only
 *  a last-4 hint is read back from connections.config. */
export function ConnectionModal({
  open,
  onClose,
  connection,
}: {
  open: boolean;
  onClose: () => void;
  connection: Tables<"connections">;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fields = PROVIDER_KEYS[connection.provider] ?? [];
  const hints = ((connection.config as { secrets?: SecretHints } | null)?.secrets ?? {}) as SecretHints;

  const [values, setValues] = useState<Record<string, string>>({});
  const [freq, setFreq] = useState(connection.sync_frequency ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  async function saveKey(keyName: string) {
    const value = (values[keyName] ?? "").trim();
    if (!value) return;
    setBusy(keyName);
    const { error } = await supabase.rpc("set_connection_secret", {
      p_provider: connection.provider,
      p_key_name: keyName,
      p_value: value,
    });
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    setValues((v) => ({ ...v, [keyName]: "" }));
    qc.invalidateQueries({ queryKey: ["connections"] });
    toast.push(`Saved ${keyName}`, "success");
  }

  async function removeKey(keyName: string) {
    setBusy(keyName);
    const { error } = await supabase.rpc("delete_connection_secret", {
      p_provider: connection.provider,
      p_key_name: keyName,
    });
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["connections"] });
    toast.push(`Removed ${keyName}`, "info");
  }

  async function setStatus(status: string) {
    setBusy("status");
    const { error } = await supabase.rpc("set_connection", {
      p_provider: connection.provider,
      p_status: status,
      p_sync_frequency: freq || null,
    });
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["connections"] });
    toast.push(status === "disconnected" ? "Disconnected" : "Updated", "info");
    if (status === "disconnected") onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Manage ${connection.display_name}`}>
      <div className="space-y-4">
        {fields.length === 0 ? (
          <p className="text-sm text-[var(--muted-hi)]">
            No API keys are required for this integration yet.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((f) => {
              const hint = hints[f.name];
              return (
                <div key={f.name}>
                  <label className={labelClass}>
                    {f.label}
                    {hint?.last4 && (
                      <span className="ml-2 font-mono text-[var(--success)]">
                        configured ····{hint.last4}
                      </span>
                    )}
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      className={inputClass + " mt-0"}
                      type="password"
                      autoComplete="off"
                      placeholder={hint?.last4 ? "Replace key…" : "Paste key…"}
                      value={values[f.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    />
                    <button
                      className={primaryBtn + " shrink-0"}
                      disabled={busy === f.name || !(values[f.name] ?? "").trim()}
                      onClick={() => saveKey(f.name)}
                    >
                      Save
                    </button>
                    {hint?.last4 && (
                      <button
                        className={ghostBtn + " shrink-0"}
                        disabled={busy === f.name}
                        onClick={() => removeKey(f.name)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <label className={labelClass}>Sync frequency</label>
          <select className={inputClass} value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="">—</option>
            {SYNC_FREQ.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <p className="text-[10px] text-[var(--muted)]">
          Keys are stored server-side in Supabase Vault and are never sent back to the
          browser. Only founders can set or clear them.
        </p>

        <div className="flex justify-between gap-2 pt-1">
          <button
            className={ghostBtn}
            disabled={busy === "status"}
            onClick={() => setStatus("disconnected")}
          >
            Disconnect
          </button>
          <div className="flex gap-2">
            <button className={ghostBtn} onClick={onClose}>
              Close
            </button>
            <button className={primaryBtn} disabled={busy === "status"} onClick={() => setStatus("connected")}>
              Save settings
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
