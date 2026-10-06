"use client";

// "Send to Google Doc" — appends the run's CURRENT copy kit (edits included)
// to the master doc. A run that was already sent gets a confirm step (appends
// have no undo), driven by the API's 409.

import { useEffect, useState } from "react";
import { shortDate } from "@/components/ui/run-ui";

export default function SendToDoc({ runId, sentAt }: { runId: number; sentAt: string | null }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ sentAt: string | null; confirm: boolean; err: string | null }>({
    sentAt, confirm: false, err: null,
  });
  useEffect(() => { if (sentAt) setState((s) => (s.sentAt && s.sentAt >= sentAt ? s : { ...s, sentAt })); }, [sentAt]);

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
      window.dispatchEvent(new Event("run:changed"));
    } catch (e) {
      setState((s) => ({ ...s, err: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setBusy(false);
    }
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
            ? "Send again?"
            : state.sentAt
              ? `Re-send to Google Doc (sent ${shortDate(state.sentAt)})`
              : "Send to Google Doc"}
      </button>
      {state.err && <span className="text-[11px] text-[var(--color-red)]">{state.err}</span>}
    </div>
  );
}
