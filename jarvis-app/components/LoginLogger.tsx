"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/queries/hooks";

// Records a single auth.login audit row per browser session (spec §10.9). Guarded
// by sessionStorage so navigation/refresh within a session doesn't spam the log;
// a fresh tab/session logs once. Best-effort — the durable audit is the DB row.
export function LoginLogger() {
  useEffect(() => {
    if (sessionStorage.getItem("jarvis:login-logged")) return;
    sessionStorage.setItem("jarvis:login-logged", "1");
    supabase.rpc("log_login").then(({ error }) => {
      if (error) sessionStorage.removeItem("jarvis:login-logged"); // allow retry next mount
    });
  }, []);
  return null;
}
