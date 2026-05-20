"use client";

type StageState = "locked" | "running" | "complete" | "error";

interface StageCardProps {
  number: number;
  title: string;
  description: string;
  state: StageState;
  children?: React.ReactNode;
}

export default function StageCard({ number, title, description, state, children }: StageCardProps) {
  const isLocked = state === "locked";
  const isRunning = state === "running";
  const isComplete = state === "complete";
  const isError = state === "error";

  const badgeCls = isError
    ? "bg-[var(--color-red-bg)] text-[var(--color-red)] border border-[var(--color-red)]/30"
    : isRunning
    ? "bg-[var(--color-accent-weak)] text-[var(--color-accent)] border border-[var(--color-accent)]/30"
    : isComplete
    ? "bg-[var(--color-green-bg)] text-[var(--color-green)] border border-[var(--color-green)]/30"
    : "bg-[var(--color-surface-3)] text-[var(--color-text-4)] border border-[var(--color-border)]";

  return (
    <div className={`border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] transition-all duration-150 ${isLocked ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-[var(--font-ibm-plex-mono)] flex-shrink-0 ${badgeCls} ${isRunning ? "animate-pulse" : ""}`}>
          {isComplete ? "✓" : isError ? "!" : number}
        </span>
        <div className="flex-1 min-w-0">
          <span className={`text-[13px] font-[550] ${isRunning || isComplete ? "text-[var(--color-text)]" : "text-[var(--color-text-3)]"}`}>
            {title}
          </span>
          <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] mt-0.5 truncate">{description}</p>
        </div>
        {isRunning && (
          <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-accent)] animate-pulse">running</span>
        )}
        {isComplete && (
          <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)]">done</span>
        )}
        {isError && (
          <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-error)]">error</span>
        )}
      </div>
      {!isLocked && children && (
        <div className="p-4">{children}</div>
      )}
    </div>
  );
}
