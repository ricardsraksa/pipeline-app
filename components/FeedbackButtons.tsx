"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Per-stage feedback control: thumbs up/down + an optional free-text note.
 * Saving:
 *  - Clicking a thumb PATCHes the vote immediately.
 *  - The note textarea appears once a vote is set; it saves on blur (and
 *    debounced after the user pauses typing).
 *  - Note is also saved when the user toggles the vote off.
 *
 * The whole component is best-effort: failed PATCHes revert local state but
 * don't surface UI errors (the loop is informational, not blocking).
 */
export default function FeedbackButtons({
  runId,
  stage,
  initialVote,
  initialNote,
}: {
  runId: number;
  stage: "stage1" | "stage2" | "stage3";
  initialVote: string | null;
  initialNote: string | null;
}) {
  const [vote, setVote] = useState<string | null>(initialVote);
  const [note, setNote] = useState<string>(initialNote ?? "");
  const [savedNote, setSavedNote] = useState<string>(initialNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from props when the parent re-fetches (e.g. polling pulls new data).
  useEffect(() => {
    setVote(initialVote);
  }, [initialVote]);
  useEffect(() => {
    setNote(initialNote ?? "");
    setSavedNote(initialNote ?? "");
  }, [initialNote]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function setVoteAndPersist(next: "up" | "down" | null) {
    const prev = vote;
    setVote(next);
    const ok = await patch({ [`feedback_${stage}`]: next });
    if (!ok) setVote(prev);
  }

  async function persistNote(text: string) {
    if (text === savedNote) return;
    setSavingNote(true);
    const ok = await patch({ [`feedback_${stage}_note`]: text || null });
    if (ok) setSavedNote(text);
    setSavingNote(false);
  }

  function onNoteChange(text: string) {
    setNote(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persistNote(text), 800);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-[var(--color-text-3)] mr-1">Was this useful?</span>
        <button
          onClick={() => setVoteAndPersist(vote === "up" ? null : "up")}
          aria-label="Mark useful"
          title="Mark useful"
          className={[
            "cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors duration-150",
            vote === "up"
              ? "border-[var(--color-green)] bg-[var(--color-green-bg)] text-[var(--color-green)]"
              : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]",
          ].join(" ")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10v12" />
            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l5-8 2 1.06A2 2 0 0 1 15 5.88z" />
          </svg>
        </button>
        <button
          onClick={() => setVoteAndPersist(vote === "down" ? null : "down")}
          aria-label="Mark not useful"
          title="Mark not useful"
          className={[
            "cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors duration-150",
            vote === "down"
              ? "border-[var(--color-red)] bg-[var(--color-red-bg)] text-[var(--color-red)]"
              : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]",
          ].join(" ")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 14V2" />
            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-5 8-2-1.06A2 2 0 0 1 9 18.12z" />
          </svg>
        </button>
      </div>
      {(vote !== null || note) && (
        <div className="w-full max-w-xs">
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={() => persistNote(note)}
            placeholder={vote === "down" ? "What was wrong? (optional, will guide future runs)" : "What worked, or what to lean into next time? (optional)"}
            rows={2}
            className="w-full text-[12px] text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-2 py-1.5 placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] resize-y"
          />
          {savingNote && (
            <p className="text-[10px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-4)] mt-0.5">Saving…</p>
          )}
        </div>
      )}
    </div>
  );
}
