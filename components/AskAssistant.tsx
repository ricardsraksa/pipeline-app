"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Ask anything about this product. A button in the corner of the run page
// opens a panel on the right; answers stream in and are saved on the run
// (lib/assistant, /api/runs/[id]/ask), so they are there next time.
interface Turn { q: string; a: string; at?: string; pending?: boolean }

export default function AskAssistant({ runId, code }: { runId: number; code: string | null }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${runId}/ask`);
      const d = await r.json().catch(() => ({})) as { thread?: Turn[] };
      if (Array.isArray(d.thread)) setThread(d.thread);
    } catch { /* keep what we have */ } finally { setLoaded(true); }
  }, [runId]);

  useEffect(() => { if (open && !loaded) void load(); }, [open, loaded, load]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask() {
    const q = draft.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null); setDraft("");
    setThread((t) => [...t, { q, a: "", pending: true }]);
    try {
      const res = await fetch(`/api/runs/${runId}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setThread((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, a: turn.a + chunk } : turn)));
      }
      setThread((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, pending: false } : turn)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
      setThread((t) => t.filter((_, i) => i !== t.length - 1));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!thread.length || !window.confirm("Clear this conversation?")) return;
    await fetch(`/api/runs/${runId}/ask`, { method: "DELETE" }).catch(() => undefined);
    setThread([]);
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask about this product"
          className="cursor-pointer fixed bottom-5 right-5 z-40 h-11 pl-3.5 pr-4 rounded-full inline-flex items-center gap-2 bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] shadow-[0_4px_16px_rgba(0,0,0,.18)] hover:opacity-90 transition-opacity duration-200">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Ask
        </button>
      )}

      {open && (
        <aside role="dialog" aria-label="Ask about this product"
          className="fixed right-0 z-40 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[-8px_0_24px_rgba(0,0,0,.12)]"
          style={{ top: 50, bottom: 0, width: "min(460px, 100vw)" }}>
          <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--color-border)] shrink-0">
            <span className="text-[13.5px] font-[600] text-[var(--color-text)]">Ask</span>
            <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{code ?? `run ${runId}`}</span>
            <div className="flex-1" />
            {thread.length > 0 && <button onClick={clear} disabled={busy} className="btn btn-sm cursor-pointer">Clear</button>}
            <button onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer w-9 h-9 grid place-items-center rounded-[6px] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] transition-colors duration-150">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {loaded && thread.length === 0 && (
              <p className="text-[12.5px] text-[var(--color-text-3)] pt-2">Questions about this product — sizing, variants, setup, positioning.</p>
            )}
            {thread.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="ml-8 rounded-[9px] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--color-text)] whitespace-pre-wrap">{t.q}</div>
                <div className="text-[13px] leading-[1.6] text-[var(--color-text)] whitespace-pre-wrap">
                  {t.a || (t.pending ? <span className="ff-mono text-[11px] text-[var(--color-text-3)]">Thinking…</span> : null)}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[var(--color-border)] p-3 shrink-0">
            {err && <p className="text-[11.5px] text-[var(--color-red)] mb-2">{err}</p>}
            <div className="flex items-end gap-2">
              <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                placeholder="Ask about this product" aria-label="Question"
                className="flex-1 resize-none px-3 py-2 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[13px] leading-[1.5] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-4)]" />
              <button onClick={() => void ask()} disabled={busy || !draft.trim()}
                className="cursor-pointer h-11 px-4 rounded-[8px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-50 transition-opacity duration-150">
                {busy ? "…" : "Send"}
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
