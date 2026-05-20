"use client";

import { useState } from "react";

interface FeedbackBarProps {
  runId: number | null;
  stage: 1 | 2 | 3;
  onSaved?: (rating: "up" | "down") => void;
}

export default function FeedbackBar({ runId, stage, onSaved }: FeedbackBarProps) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!runId) return null;

  async function save(selectedRating: "up" | "down") {
    if (!runId) return;
    setSaving(true);
    const field = `feedback_stage${stage}` as const;
    try {
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: selectedRating, notes: notes || null }),
      });
      setSaved(true);
      onSaved?.(selectedRating);
    } finally {
      setSaving(false);
    }
  }

  function handleRating(r: "up" | "down") {
    setRating(r);
    setSaved(false);
  }

  if (saved) {
    return (
      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
        <span className="text-[var(--color-text-3)] text-[11px] font-[var(--font-ibm-plex-mono)]">Feedback saved</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">
          Rate stage {stage}
        </span>
        <button
          onClick={() => handleRating("up")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded border font-[var(--font-ibm-plex-mono)] text-xs transition-colors duration-150 ${
            rating === "up"
              ? "bg-[var(--color-green-bg)] text-[var(--color-green)] border-[var(--color-green)]/50"
              : "border-[var(--color-border)] text-[var(--color-text-3)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          }`}
        >
          ↑
        </button>
        <button
          onClick={() => handleRating("down")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded border font-[var(--font-ibm-plex-mono)] text-xs transition-colors duration-150 ${
            rating === "down"
              ? "bg-[var(--color-red-bg)] text-[var(--color-red)] border-[var(--color-red)]/50"
              : "border-[var(--color-border)] text-[var(--color-text-3)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          }`}
        >
          ↓
        </button>
      </div>
      {rating && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 200))}
            onKeyDown={(e) => e.key === "Enter" && save(rating)}
            placeholder="Notes (optional)"
            className="flex-1 w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[9px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] placeholder:text-[var(--color-text-4)] disabled:opacity-40"
          />
          <button
            onClick={() => save(rating)}
            disabled={saving}
            className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
