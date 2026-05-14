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
      <div className="flex items-center gap-2 pt-3 border-t border-[#1a1a1a] mt-3">
        <span className="text-xs font-mono text-[#16a34a]">Feedback saved</span>
      </div>
    );
  }

  return (
    <div className="pt-3 border-t border-[#1a1a1a] mt-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-[#404040] uppercase tracking-wider">
          Stage {stage} quality
        </span>
        <button
          onClick={() => handleRating("up")}
          disabled={saving}
          className={[
            "w-7 h-7 rounded text-sm transition-colors",
            rating === "up"
              ? "bg-[#16a34a]/20 text-[#16a34a] border border-[#16a34a]/40"
              : "bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[#737373] hover:text-[#e5e5e5]",
          ].join(" ")}
        >
          ↑
        </button>
        <button
          onClick={() => handleRating("down")}
          disabled={saving}
          className={[
            "w-7 h-7 rounded text-sm transition-colors",
            rating === "down"
              ? "bg-[#dc2626]/20 text-[#dc2626] border border-[#dc2626]/40"
              : "bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[#737373] hover:text-[#e5e5e5]",
          ].join(" ")}
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
            placeholder="What worked or didn't? (optional)"
            className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-3 py-1.5 text-xs text-[#e5e5e5] placeholder-[#404040] focus:outline-none focus:border-[#2563eb]"
          />
          <button
            onClick={() => save(rating)}
            disabled={saving}
            className="px-3 py-1.5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 rounded text-xs font-mono text-white transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
