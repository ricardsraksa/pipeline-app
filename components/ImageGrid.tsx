"use client";

import type { ImagePrompt } from "@/app/api/stage3-prompts/route";

interface ImageSlot {
  prompt: ImagePrompt;
  imageUrl?: string;
  status: "pending" | "loading" | "done" | "error";
  error?: string;
}

interface ImageGridProps {
  slots: ImageSlot[];
  currentIndex: number | null;
  onRetry?: (index: number) => void;
}

export default function ImageGrid({ slots, currentIndex, onRetry }: ImageGridProps) {
  const infographics = slots.filter((s) => s.prompt.category === "INFOGRAPHIC");
  const contextuals = slots.filter((s) => s.prompt.category === "CONTEXTUAL");

  return (
    <div className="space-y-3">
      {currentIndex !== null && (
        <p className="text-xs font-[var(--font-ibm-plex-mono)] text-[var(--color-accent)]">
          <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mr-2 align-middle" />
          Generating image {currentIndex} of {slots.length}...
        </p>
      )}

      {infographics.length > 0 && (
        <div>
          <p className="text-[11px] font-[650] uppercase tracking-[0.08em] text-[var(--color-text-3)] mb-2">
            Infographic
          </p>
          <div className="grid grid-cols-3 gap-2">
            {infographics.map((slot) => (
              <ImageSlotCell key={slot.prompt.index} slot={slot} onRetry={onRetry} />
            ))}
          </div>
        </div>
      )}

      {contextuals.length > 0 && (
        <div>
          <p className="text-[11px] font-[650] uppercase tracking-[0.08em] text-[var(--color-text-3)] mb-2">
            Contextual
          </p>
          <div className="grid grid-cols-4 gap-2">
            {contextuals.map((slot) => (
              <ImageSlotCell key={slot.prompt.index} slot={slot} onRetry={onRetry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageSlotCell({
  slot,
  onRetry,
}: {
  slot: ImageSlot;
  onRetry?: (index: number) => void;
}) {
  const { prompt, imageUrl, status, error } = slot;

  return (
    <div className="aspect-square rounded-[9px] border border-[var(--color-border)] overflow-hidden relative bg-[var(--color-surface-2)]">
      {status === "done" && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`Image ${prompt.index}`}
          className="w-full h-full object-cover fade-in"
        />
      ) : status === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2">
          <span className="text-[var(--color-error)] text-xs font-[var(--font-ibm-plex-mono)] text-center">Failed</span>
          {error && (
            <span className="text-[var(--color-text-3)] text-xs text-center line-clamp-2">{error}</span>
          )}
          {onRetry && (
            <button
              onClick={() => onRetry(prompt.index)}
              className="cursor-pointer text-xs text-[var(--color-accent)] hover:underline font-[var(--font-ibm-plex-mono)] mt-1"
            >
              Retry
            </button>
          )}
        </div>
      ) : status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="pulse-dot w-3 h-3 rounded-full bg-[var(--color-accent)]" />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-[var(--color-border-strong)] font-[var(--font-ibm-plex-mono)] text-lg">{prompt.index}</span>
          <span className="text-[var(--color-text-4)] text-xs">{prompt.category}</span>
        </div>
      )}

      <span className="absolute bottom-1 left-1 text-xs font-[var(--font-ibm-plex-mono)] text-white/50 bg-black/40 px-1 rounded leading-none py-0.5">
        {prompt.index}
      </span>
    </div>
  );
}
