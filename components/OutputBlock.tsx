"use client";

interface OutputBlockProps {
  text: string;
  monospace?: boolean;
}

export default function OutputBlock({ text, monospace = false }: OutputBlockProps) {
  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface-2)] p-4 max-h-[520px] overflow-y-auto">
      <pre
        className={[
          "whitespace-pre-wrap break-words text-[var(--color-text)] leading-relaxed",
          monospace ? "font-[var(--font-ibm-plex-mono)] text-[12px]" : "text-[13px]",
        ].join(" ")}
        style={{ fontFamily: monospace ? undefined : "var(--font-dm-sans), DM Sans, sans-serif" }}
      >
        {text}
      </pre>
    </div>
  );
}
