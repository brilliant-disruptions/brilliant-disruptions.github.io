"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-md rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-[var(--white)]">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--muted-hi)] hover:text-[var(--white)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] px-3 py-2 text-sm text-[var(--white)] outline-none focus:border-[var(--cyan)]";
export const labelClass =
  "font-mono text-[10px] uppercase tracking-wide text-[var(--muted-hi)]";
export const primaryBtn =
  "rounded-lg bg-[var(--cyan)] px-4 py-2 text-sm font-semibold text-black transition hover:shadow-[0_0_24px_rgba(0,229,255,0.35)] disabled:opacity-60";
export const ghostBtn =
  "rounded-lg border border-[var(--glass-border-2)] px-4 py-2 text-sm text-[var(--muted-hi)] hover:text-[var(--white)]";
