"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; tone: "info" | "success" | "error" };
type ToastCtx = { push: (text: string, tone?: Toast["tone"]) => void };

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="glass animate-[fadeIn_.2s_ease] rounded-lg border-l-2 px-3 py-2 text-sm text-[var(--white)]"
            style={{
              borderLeftColor:
                t.tone === "success"
                  ? "var(--success)"
                  : t.tone === "error"
                    ? "var(--danger)"
                    : "var(--cyan)",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
