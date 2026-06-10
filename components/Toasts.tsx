"use client";

// Toast system from the v2 design (engine.jsx): bottom-right, auto-dismiss,
// success/default tones. Exposed app-wide via context so any screen can push.

import { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "@/components/ui/Icon";

type Toast = { id: string; msg: string; tone: "default" | "success" };
type ToastCtx = { push: (msg: string, tone?: "default" | "success") => void };

const Ctx = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: "default" | "success" = "default") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="rise pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)]">
            {t.tone === "success"
              ? <span className="grid place-items-center w-4 h-4 rounded-full bg-[var(--color-green)] text-[var(--color-on-primary)]"><Icon.Check className="w-3 h-3" strokeWidth={3} /></span>
              : <Icon.Spark className="w-4 h-4 text-[var(--color-accent)]" />}
            <span className="text-[12.5px] font-[550] text-[var(--color-text)]">{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
