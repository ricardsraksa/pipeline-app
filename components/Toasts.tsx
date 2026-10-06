"use client";

// Toast system from the v2 design (engine.jsx): top-right, clear of the Ask
// button. Success toasts auto-dismiss; everything else (errors) stays until
// dismissed. Exposed app-wide via context so any screen can push.

import { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "@/components/ui/Icon";

type Toast = { id: string; msg: string; tone: "default" | "success" };
type ToastCtx = { push: (msg: string, tone?: "default" | "success") => void };

const Ctx = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((msg: string, tone: "default" | "success" = "default") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone }]);
    if (tone === "success") setTimeout(() => dismiss(id), 2600);
  }, [dismiss]);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-[62px] right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none max-w-[min(420px,calc(100vw-32px))]">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "success" ? "status" : "alert"}
            className="rise pointer-events-auto flex items-start gap-2.5 pl-4 pr-2 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)]">
            {t.tone === "success"
              ? <span className="mt-px grid place-items-center w-4 h-4 shrink-0 rounded-full bg-[var(--color-green)] text-[var(--color-on-primary)]"><Icon.Check className="w-3 h-3" strokeWidth={3} /></span>
              : <Icon.Alert className="mt-px w-4 h-4 shrink-0 text-[var(--color-red)]" />}
            <span className="text-[12.5px] font-[550] text-[var(--color-text)] break-words min-w-0">{t.msg}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss"
              className="cursor-pointer -my-1 shrink-0 grid place-items-center w-7 h-7 rounded-[5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-150">
              <Icon.X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
