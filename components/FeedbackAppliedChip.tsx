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

const ThumbUp = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="useful">
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l5-8 2 1.06A2 2 0 0 1 15 5.88z" />
  </svg>
);
const ThumbDown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="not useful">
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-5 8-2-1.06A2 2 0 0 1 9 18.12z" />
  </svg>
);

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
       
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        Applied {items.length} past feedback{items.length === 1 ? "" : "s"}
        <span className="text-[var(--color-text-4)] text-[10px]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-1.5 border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] p-3 space-y-2">
          <ul className="space-y-1.5">
            {items.map((it) => {
              const name = (it.brand_name ?? it.product_name ?? "previous run").trim();
              const v = it.vote === "up" ? <ThumbUp /> : it.vote === "down" ? <ThumbDown /> : "—";
              return (
                <li key={it.id} className="text-[12px] leading-relaxed text-[var(--color-text-2)]">
                  <span className="inline-flex align-[-2px] font-[600] text-[var(--color-text)]">{v}</span>{" "}
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
        </div>
      )}
    </div>
  );
}
