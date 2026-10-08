"use client";

// New run, started straight from Runs: name, links, priority, AliExpress link.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toasts";
import { CheckIcon, cx, inputCls } from "./shared";

const looksLikeUrl = (s: string) => { try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

export default function NewRunForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [name, setName] = useState("");
  const [links, setLinks] = useState("");
  const [priority, setPriority] = useState(false);
  const [ali, setAli] = useState("");
  const [busy, setBusy] = useState(false);
  const canStart = name.trim() !== "" && looksLikeUrl(ali.trim()) && !busy;

  async function start() {
    if (!canStart) return;
    setBusy(true);
    try {
      const res = await fetch("/api/import/start-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, links, priority, productUrl: ali.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; runId?: number; code?: string; error?: string };
      if (!res.ok || !d.success || !d.runId) { push(d.error ?? `Not started (${res.status})`); return; }
      push(`${d.code} started`, "success");
      router.push(`/runs/${d.runId}`);
    } catch {
      push("Not started: no connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-[26px] border border-[var(--color-border-strong)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-[11px]">
      <div className="grid gap-3 items-start" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr) 40px minmax(0,1.2fr) 76px 32px" }}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" aria-label="Product name" disabled={busy}
          className={cx(inputCls, "h-[36px]")} />
        <textarea value={links} onChange={(e) => setLinks(e.target.value)} placeholder="Links" aria-label="Links" disabled={busy} spellCheck={false}
          rows={Math.min(4, Math.max(1, links.split("\n").length))}
          className={cx(inputCls, "py-[8px] min-h-[36px] ff-mono text-[12px] resize-none")} />
        <button onClick={() => setPriority((p) => !p)} disabled={busy} aria-pressed={priority} title="Priority" aria-label="Priority"
          className={cx("cursor-pointer w-[36px] h-[36px] grid place-items-center rounded-[6px] border tr",
            priority ? "border-[var(--color-priority)] text-[var(--color-priority)] bg-[var(--color-priority-bg)]" : "border-[var(--color-border-strong)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)]")}>
          <CheckIcon />
        </button>
        <input value={ali} onChange={(e) => setAli(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void start(); }}
          placeholder="AliExpress link" aria-label="AliExpress link" disabled={busy} spellCheck={false}
          className={cx(inputCls, "h-[36px] ff-mono text-[12px]", ali.trim() !== "" && !looksLikeUrl(ali.trim()) && "border-[var(--color-red)]")} />
        <button onClick={start} disabled={!canStart}
          className="cursor-pointer h-9 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed tr">
          {busy ? "…" : "Start"}
        </button>
        <button onClick={onClose} disabled={busy} title="Close" aria-label="Close"
          className="cursor-pointer w-8 h-9 grid place-items-center rounded-[6px] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] tr">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>
  );
}
