"use client";

// Bits shared by the Import and Start runs pages.

import { useCallback, useEffect, useState } from "react";
import type { ImportItem } from "@/lib/import/store";

export type { ImportItem };

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export const inputCls = "px-[10px] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[6px] outline-none text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] tr";

/** Priority mark in the app (the doc's tab titles use 💦). */
export function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PriorityBadge() {
  return (
    <span title="Priority" className="inline-flex items-center text-[var(--color-priority)]">
      <CheckIcon className="w-[15px] h-[15px]" />
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
