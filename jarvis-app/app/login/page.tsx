"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "./actions";

function LoginCard() {
  const params = useSearchParams();
  const denied = params.get("denied");
  const [state, formAction, pending] = useActionState(signIn, null);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="glass rounded-2xl w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <div className="font-display text-3xl font-bold tracking-tight text-[var(--cyan)]">
            JARVIS
          </div>
          <p className="mt-2 text-sm text-[var(--muted-hi)]">
            Brilliant Disruptions — command &amp; control
          </p>
        </div>

        {denied && (
          <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            This account isn&apos;t an authorized member.
          </div>
        )}
        {state?.error && (
          <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-[var(--muted-hi)]">
              Email
            </label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 w-full rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] px-3 py-2.5 text-[var(--white)] outline-none focus:border-[var(--cyan)]"
            />
          </div>
          <div>
            <label className="font-mono text-xs uppercase tracking-wide text-[var(--muted-hi)]">
              Password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] px-3 py-2.5 text-[var(--white)] outline-none focus:border-[var(--cyan)]"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-[var(--cyan)] px-4 py-2.5 font-semibold text-black transition hover:shadow-[0_0_30px_rgba(0,229,255,0.35)] disabled:opacity-60"
          >
            {pending ? "Authenticating…" : "Access JARVIS"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
