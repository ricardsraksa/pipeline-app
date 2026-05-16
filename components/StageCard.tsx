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

  return (
    <div className={`border border-[#111] rounded-md transition-all duration-150 ${isLocked ? "opacity-25" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#111]">
        <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono flex-shrink-0 ${
          isError   ? "bg-[#ff3b30]/15 text-[#ff3b30] ring-1 ring-[#ff3b30]/30" :
          isRunning ? "bg-white text-black" :
          isComplete ? "bg-white text-black" :
          "bg-[#111] text-[#444]"
        }`}>
          {isComplete ? "✓" : isError ? "!" : number}
        </span>
        <div className="flex-1">
          <span className={`font-mono text-[13px] ${isRunning || isComplete ? "text-white" : "text-[#444]"}`}>
            {title}
          </span>
          <p className="font-mono text-[10px] text-[#333] mt-0.5">{description}</p>
        </div>
        {isRunning && (
          <span className="font-mono text-[10px] text-white/50 animate-pulse tracking-wider">running</span>
        )}
        {isComplete && (
          <span className="font-mono text-[10px] text-[#444]">done</span>
        )}
        {isError && (
          <span className="font-mono text-[10px] text-[#ff3b30]">error</span>
        )}
      </div>
      {!isLocked && children && (
        <div className="p-4">{children}</div>
      )}
    </div>
  );
}
