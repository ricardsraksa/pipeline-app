"use client";

// "Send to Google Doc" — appends the run's CURRENT copy kit (edits included)
// to the master doc. A run that was already sent gets a confirm step (appends
// have no undo), driven by the API's 409.

import { useState } from "react";

// The rail's row style: name left, mono state right, whole row clickable —
// the same shape as the stage list above it. Reused by SendToDrive.
export const railRow = "w-full grid items-center gap-2.5 px-2.5 h-[34px] rounded-[6px] text-left cursor-pointer hover:bg-[var(--color-surface-2)] tr disabled:cursor-default disabled:hover:bg-transparent";
export const railRowCols = { gridTemplateColumns: "minmax(0,1fr) auto" } as const;

export default function SendToDoc({ runId, sentAt, variant = "button" }: { runId: number; sentAt: string | null; variant?: "button" | "row" }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ sentAt: string | null; confirm: boolean; err: string | null }>({
    sentAt, confirm: false, err: null,
  });

  async function send(force: boolean) {
    setBusy(true);
    setState((s) => ({ ...s, err: null }));
    try {
      const res = await fetch("/api/gdoc/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, force }),
      });
      const data = await res.json();
      if (res.status === 409) { setState((s) => ({ ...s, confirm: true })); return; }
      if (!data.success) { setState((s) => ({ ...s, err: data.error ?? `Failed (${res.status})` })); return; }
      setState({ sentAt: data.appended_at as string, confirm: false, err: null });
    } catch (e) {
      setState((s) => ({ ...s, err: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setBusy(false);
    }
  }

  if (variant === "row") {
    const status = busy ? "sending…" : state.confirm ? "send again?" : state.err ? "failed" : state.sentAt ? `sent ${state.sentAt.slice(5, 10)}` : "ready";
    return (
      <>
        <button onClick={() => send(state.confirm)} disabled={busy} className={railRow} style={railRowCols} title={state.err ?? (state.sentAt ? "Already in the doc — click to send again" : "Send the copy kit to the product's tab")}>
          <span className="text-[13px] font-[500] text-[var(--color-text)]">Google Doc</span>
          <span className="ff-mono text-[11px]" style={{ color: state.err ? "var(--color-red)" : state.confirm ? "var(--color-amber)" : "var(--color-text-3)" }}>{status}</span>
        </button>
        {state.err && <p className="px-2.5 text-[11px] leading-snug text-[var(--color-red)] break-words">{state.err}</p>}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => send(state.confirm)}
        disabled={busy}
        className="btn btn-sm"
      >
        {busy
          ? "Sending…"
          : state.confirm
            ? "Send again (already in doc) — confirm"
            : state.sentAt
              ? `Re-send to Google Doc (sent ${state.sentAt.slice(0, 10)})`
              : "Send to Google Doc"}
      </button>
      {state.err && <span className="text-[11px] text-[var(--color-red)]">{state.err}</span>}
    </div>
  );
}
