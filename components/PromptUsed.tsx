"use client";

// Collapsible viewer for the exact system prompt(s) a run executed with.
// Data comes from runs.prompts_used (recorded at execution time), so it stays
// accurate even after the Settings override or the code default changes.
// Runs from before the feature existed have nothing recorded — say so instead
// of guessing.

import { useState } from "react";

const STAGE_KEYS: Record<"stage1" | "stage2" | "stage3", Array<{ key: string; label: string }>> = {
  stage1: [{ key: "stage1", label: "Research one-pager system prompt" }],
  stage2: [{ key: "stage2", label: "Copy system prompt" }],
  stage3: [
    { key: "stage3_hero", label: "Hero prompt-writer system prompt" },
    { key: "stage3_remaining", label: "8-prompts writer system prompt" },
  ],
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="cursor-pointer text-[10.5px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] tr"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function PromptUsed({
  promptsUsed,
  stage,
}: {
  promptsUsed: string | null;
  stage: "stage1" | "stage2" | "stage3";
}) {
  const [open, setOpen] = useState(false);

  let parsed: Record<string, string> = {};
  try {
    const p = promptsUsed ? JSON.parse(promptsUsed) : {};
    if (p && typeof p === "object" && !Array.isArray(p)) parsed = p;
  } catch { /* treat as empty */ }

  const entries = STAGE_KEYS[stage]
    .map((k) => ({ ...k, prompt: parsed[k.key] }))
    .filter((k): k is { key: string; label: string; prompt: string } => typeof k.prompt === "string" && k.prompt.length > 0);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr"
      >
        {open ? "Hide prompt used" : "View prompt used"}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {entries.length === 0 ? (
            <p className="text-[11.5px] text-[var(--color-text-3)] italic">
              Not recorded — this run predates prompt snapshots, so the exact prompt it used can&apos;t be shown.
            </p>
          ) : (
            entries.map((e) => (
              <div key={e.key} className="border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-surface)] overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  <span className="text-[10.5px] uppercase tracking-widest text-[var(--color-text-3)] font-[var(--font-ibm-plex-mono)]">
                    {e.label} · {e.prompt.length.toLocaleString()} chars
                  </span>
                  <CopyBtn text={e.prompt} />
                </div>
                <pre className="px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-text-2)] font-[var(--font-ibm-plex-mono)] whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
                  {e.prompt}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
