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
      <div className="mt-3 pt-3 border-t border-zinc-800">
        <span className="text-zinc-500 text-[11px] font-mono">Feedback saved</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Rate stage {stage}
        </span>
        <button
          onClick={() => handleRating("up")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded font-mono text-xs transition-colors duration-150 ${
            rating === "up"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200"
          }`}
        >
          ↑
        </button>
        <button
          onClick={() => handleRating("down")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded font-mono text-xs transition-colors duration-150 ${
            rating === "down"
              ? "bg-red-500/10 text-red-400 border border-red-500/30"
              : "border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200"
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
            className="flex-1 w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10 rounded-lg px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => save(rating)}
            disabled={saving}
            className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
