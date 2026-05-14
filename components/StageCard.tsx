"use client";

type StageState = "locked" | "running" | "complete" | "error";

interface StageCardProps {
  number: number;
  title: string;
  description: string;
  state: StageState;
  children?: React.ReactNode;
}

export default function StageCard({
  number,
  title,
  description,
  state,
  children,
}: StageCardProps) {
  const isLocked = state === "locked";
  const isRunning = state === "running";
  const isComplete = state === "complete";
  const isError = state === "error";

  return (
    <div
      className={[
        "rounded-lg border transition-all duration-200",
        isLocked
          ? "border-[#1e1e1e] bg-[#0d0d0d] opacity-40"
          : isRunning
          ? "border-[#2563eb] bg-[#0d0d0d] shadow-[0_0_0_1px_rgba(37,99,235,0.2)]"
          : isComplete
          ? "border-[#2a2a2a] bg-[#0d0d0d]"
          : "border-[#dc2626] bg-[#0d0d0d]",
      ].join(" ")}
    >
      <div className="px-5 py-4 flex items-start gap-4 border-b border-[#1a1a1a]">
        <div
          className={[
            "flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs font-mono font-semibold",
            isLocked
              ? "bg-[#1a1a1a] text-[#404040]"
              : isRunning
              ? "bg-[#2563eb] text-white"
              : isComplete
              ? "bg-[#16a34a] text-white"
              : "bg-[#dc2626] text-white",
          ].join(" ")}
        >
          {isComplete ? "✓" : isError ? "!" : number}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2
              className={[
                "font-mono text-sm font-semibold tracking-wide uppercase",
                isLocked ? "text-[#404040]" : "text-[#e5e5e5]",
              ].join(" ")}
            >
              {title}
            </h2>
            {isRunning && (
              <span className="flex items-center gap-1.5 text-[#2563eb] text-xs font-mono">
                <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-[#2563eb] inline-block" />
                Running...
              </span>
            )}
            {isComplete && (
              <span className="text-[#16a34a] text-xs font-mono">Complete</span>
            )}
            {isError && (
              <span className="text-[#dc2626] text-xs font-mono">Failed</span>
            )}
          </div>
          <p
            className={[
              "text-xs mt-0.5",
              isLocked ? "text-[#333]" : "text-[#737373]",
            ].join(" ")}
          >
            {description}
          </p>
        </div>
      </div>

      {!isLocked && children && (
        <div className="p-5 fade-in">{children}</div>
      )}
    </div>
  );
}
