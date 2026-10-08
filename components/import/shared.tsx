"use client";

// Bits shared by the Import and Start runs pages.

import { useCallback, useEffect, useState } from "react";
import type { ImportItem } from "@/lib/import/store";

export type { ImportItem };

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export const inputCls = "px-[10px] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[6px] outline-none text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] tr";

/** Priority mark: drawn droplets (the doc uses 💦 in tab titles). */
export function SplashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M9 3c-.3 0-.5.2-.7.4C7 5.6 4 9.6 4 12.5A5 5 0 0 0 9 17.5a5 5 0 0 0 5-5c0-2.9-3-6.9-4.3-9.1A.8.8 0 0 0 9 3Z" />
      <path d="M17 10c-.2 0-.4.1-.5.3-.8 1.4-2.5 3.8-2.5 5.5a3 3 0 0 0 6 0c0-1.7-1.7-4.1-2.5-5.5a.6.6 0 0 0-.5-.3Z" opacity=".7" />
    </svg>
  );
}

export function PriorityBadge() {
  return (
    <span title="Priority" className="inline-flex items-center text-[var(--color-accent)]">
      <SplashIcon className="w-[15px] h-[15px]" />
      <span className="sr-only">Priority</span>
    </span>
  );
}

/** Where an item's doc tab stands, in a few words. */
export function docStatus(item: ImportItem, docConfigured: boolean): { text: string; tone: "ok" | "wait" | "bad" | "off" } {
  if (!docConfigured) return { text: "doc not connected", tone: "off" };
  if (item.docError) return { text: `doc: ${item.docError}`, tone: "bad" };
  if (!item.docTabId) return { text: "tab pending", tone: "wait" };
  return { text: "in doc", tone: "ok" };
}

export const isInstagram = (url: string) => {
  try { const h = new URL(url).hostname.toLowerCase(); return h === "instagram.com" || h.endsWith(".instagram.com"); } catch { return false; }
};

/** The open Import list, refreshed on demand and every 10s (doc tabs land in the background). */
export function useImportList() {
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [docConfigured, setDocConfigured] = useState(true);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/import", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { items: ImportItem[]; docConfigured: boolean };
      setItems(d.items);
      setDocConfigured(d.docConfigured);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(() => { if (!document.hidden) void reload(); }, 10_000);
    return () => clearInterval(t);
  }, [reload]);
  return { items, docConfigured, failed, reload };
}
