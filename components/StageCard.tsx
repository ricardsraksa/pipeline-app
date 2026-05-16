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
    ? "bg-red-500/10 text-red-400 border border-red-500/30"
    : isRunning
    ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
    : isComplete
    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
    : "bg-zinc-900 text-zinc-600 border border-zinc-800";

  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/40 transition-all duration-150 ${isLocked ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono flex-shrink-0 ${badgeCls} ${isRunning ? "animate-pulse" : ""}`}>
          {isComplete ? "✓" : isError ? "!" : number}
        </span>
        <div className="flex-1 min-w-0">
          <span className={`font-mono text-[13px] ${isRunning || isComplete ? "text-zinc-100" : "text-zinc-500"}`}>
            {title}
          </span>
          <p className="font-mono text-[10px] text-zinc-600 mt-0.5 truncate">{description}</p>
        </div>
        {isRunning && (
          <span className="font-mono text-[10px] text-blue-400 animate-pulse">running</span>
        )}
        {isComplete && (
          <span className="font-mono text-[10px] text-zinc-600">done</span>
        )}
        {isError && (
          <span className="font-mono text-[10px] text-red-400">error</span>
        )}
      </div>
      {!isLocked && children && (
        <div className="p-4">{children}</div>
      )}
    </div>
  );
}
