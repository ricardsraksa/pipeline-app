"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface AIRegenerateProps {
  runId: number;
  stage: "stage1" | "stage2" | "stage3-prompts";
  /** Called with the new output once regeneration succeeds */
  onRegenerated: (newOutput: string) => void;
  /** Label override for the trigger button (defaults to "Edit with AI") */
  triggerLabel?: string;
}

const STAGE_HINTS: Record<AIRegenerateProps["stage"], string> = {
  stage1:
    "e.g. Add more technical detail about the filtration system, or focus the benefits on long-term health outcomes.",
  stage2:
    "e.g. Make the tone warmer and less technical, or shorten the hero headline.",
  "stage3-prompts":
    "e.g. Use darker backgrounds and add rim lighting to all contextual shots.",
};

export default function AIRegenerate({
  runId,
  stage,
  onRegenerated,
  triggerLabel = "Edit with AI",
}: AIRegenerateProps) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    if (instructions.trim().length < 5) {
      setError("Instructions must be at least 5 characters");
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/regenerate/${stage}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, instructions: instructions.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? `Regeneration failed (HTTP ${res.status})`);
        return;
      }
      onRegenerated(data.output as string);
      setInstructions("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRegenerating(false);
    }
  }

  function close() {
    setOpen(false);
    setInstructions("");
    setError(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-hover)] text-[var(--color-text-2)] hover:text-[var(--color-text)] text-[11px] font-mono transition-colors duration-150"
      >
        <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        {triggerLabel}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[color:rgb(107_158_200_/_0.30)] bg-[color:rgb(107_158_200_/_0.05)] px-4 py-3.5 fade-in space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Tell Claude what to change
          </span>
        </div>
        <button
          onClick={close}
          aria-label="Close"
          disabled={regenerating}
          className="cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
        >
          <Icon.X className="w-3.5 h-3.5" />
        </button>
      </div>

      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder={STAGE_HINTS[stage]}
        rows={3}
        autoFocus
        disabled={regenerating}
        className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)]/60 focus:ring-2 focus:ring-[var(--color-accent)]/15 rounded-lg px-3 py-2 text-[12px] text-[var(--color-text)] placeholder-[var(--color-text-4)] focus:outline-none transition-colors resize-y disabled:opacity-50"
      />

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-[var(--color-error)]">
          <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleRegenerate}
          disabled={regenerating || instructions.trim().length < 5}
          className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium transition-colors duration-150"
        >
          {regenerating ? (
            <>
              <Icon.Loader className="w-3.5 h-3.5" />
              Regenerating&hellip;
            </>
          ) : (
            <>
              <Icon.Spark className="w-3.5 h-3.5" />
              Regenerate
            </>
          )}
        </button>
        <button
          onClick={close}
          disabled={regenerating}
          className="cursor-pointer h-8 px-3 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-3)] hover:text-[var(--color-text)] text-[12px] transition-colors duration-150 disabled:opacity-40"
        >
          Cancel
        </button>
        <p className="ml-auto font-mono text-[10px] text-[var(--color-text-3)] hidden sm:block">
          Replaces current edits · inline editing still works after
        </p>
      </div>
    </div>
  );
}
