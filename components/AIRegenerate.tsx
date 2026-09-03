"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface AIRegenerateProps {
  runId: number;
  stage: "stage1" | "stage2" | "stage3-prompts";
  /** Called with the new output once regeneration succeeds */
  onRegenerated: (newOutput: string) => void;
  /** Label override for the trigger button (defaults to "Edit with AI") */
  triggerLabel?: string;
  /** If provided, pre-fills the instructions textarea — typically the user's
   *  saved 👎/👍 note for this stage, so they don't have to retype what
   *  they already told the feedback loop. */
  initialFeedback?: string | null;
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
  initialFeedback = null,
}: AIRegenerateProps) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState(initialFeedback ?? "");

  // Re-sync the textarea to the latest saved feedback every time the panel
  // opens — so the user always sees their current note pre-filled.
  useEffect(() => {
    if (open) setInstructions(initialFeedback ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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
        className="btn btn-sm"
      >
        <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        {triggerLabel}
      </button>
    );
  }

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-accent-weak)] px-4 py-3.5 fade-in space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon.Spark className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <span className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-accent-text)]">
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
        className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] text-sm transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-y placeholder:text-[var(--color-text-4)] disabled:opacity-50"
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
          className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
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
          className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-40"
        >
          Cancel
        </button>
        <p className="ml-auto font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] hidden sm:block">
          Replaces current edits · inline editing still works after
        </p>
      </div>
    </div>
  );
}
