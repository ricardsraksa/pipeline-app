"use client";

import { useEffect, useState } from "react";

interface Item {
  id: number;
  product_name: string | null;
  brand_name: string | null;
  vote: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Small chip that shows how many past feedback notes are being applied to a
 * stage's next generation. Click to expand and see exactly which notes — the
 * same rows lib/feedback.ts will inject into the system prompt.
 */
export default function FeedbackAppliedChip({
  stage,
  className = "",
}: {
  stage: 1 | 2 | 3;
  className?: string;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/feedback/recent?stage=${stage}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  if (!items || items.length === 0) return null;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer inline-flex items-center gap-1.5 text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-3)] hover:text-[var(--color-text)] border border-dashed border-[var(--color-border)] rounded-full px-2.5 py-1 transition-colors"
        title="Past feedback that will steer the next regeneration of this stage"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        Applied {items.length} past feedback{items.length === 1 ? "" : "s"}
        <span className="text-[var(--color-text-4)] text-[10px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 z-40 w-[min(360px,90vw)] border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(20,20,18,.08)] p-3 space-y-2">
          <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">
            Steering the next run
          </p>
          <ul className="space-y-1.5">
            {items.map((it) => {
              const name = (it.brand_name ?? it.product_name ?? "previous run").trim();
              const v = it.vote === "up" ? "👍" : it.vote === "down" ? "👎" : "—";
              return (
                <li key={it.id} className="text-[12px] leading-relaxed text-[var(--color-text-2)]">
                  <span className="font-[600] text-[var(--color-text)]">{v}</span>{" "}
                  <span className="text-[var(--color-text-3)]">{name}</span>
                  {it.note ? (
                    <>
                      {" — "}
                      <span>{it.note}</span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-[var(--color-text-4)] pt-1 border-t border-[var(--color-border)]">
            Soft hints — the model is informed but not forced.
          </p>
        </div>
      )}
    </div>
  );
}
