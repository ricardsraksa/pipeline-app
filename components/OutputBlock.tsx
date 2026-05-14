"use client";

interface OutputBlockProps {
  text: string;
  monospace?: boolean;
}

export default function OutputBlock({ text, monospace = false }: OutputBlockProps) {
  return (
    <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-md p-4 max-h-[520px] overflow-y-auto">
      <pre
        className={[
          "whitespace-pre-wrap break-words text-[#d4d4d4] leading-relaxed",
          monospace ? "font-mono text-xs" : "text-sm",
        ].join(" ")}
        style={{ fontFamily: monospace ? undefined : "var(--font-dm-sans), DM Sans, sans-serif" }}
      >
        {text}
      </pre>
    </div>
  );
}
