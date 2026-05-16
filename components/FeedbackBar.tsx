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
      <div className="mt-3 pt-3 border-t border-[#111]">
        <span className="font-mono text-[11px] text-[#444]">Feedback saved</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-[#111] space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-[#333] uppercase tracking-[0.15em]">
          Rate stage {stage}
        </span>
        <button
          onClick={() => handleRating("up")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded font-mono text-xs transition-colors duration-150 ${
            rating === "up"
              ? "bg-white text-black"
              : "border border-[#1e1e1e] text-[#444] hover:border-[#333] hover:text-white"
          }`}
        >
          ↑
        </button>
        <button
          onClick={() => handleRating("down")}
          disabled={saving}
          className={`cursor-pointer w-7 h-7 rounded font-mono text-xs transition-colors duration-150 ${
            rating === "down"
              ? "bg-[#ff3b30]/15 text-[#ff3b30] ring-1 ring-[#ff3b30]/30"
              : "border border-[#1e1e1e] text-[#444] hover:border-[#333] hover:text-white"
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
            className="flex-1 bg-[#050505] border border-[#1c1c1c] focus:border-[#333] rounded px-3 py-1.5 font-mono text-[11px] text-white placeholder-[#2a2a2a] focus:outline-none transition-colors duration-150"
          />
          <button
            onClick={() => save(rating)}
            disabled={saving}
            className="cursor-pointer px-3 py-1.5 bg-white hover:bg-[#e5e5e5] disabled:opacity-40 text-black rounded font-mono text-[11px] transition-colors duration-150"
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
