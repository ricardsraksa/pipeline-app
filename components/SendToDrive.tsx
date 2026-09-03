"use client";

// "Send images to Drive" — uploads the run's final images into the product's
// Drive folder (created on first send). Skip-if-exists, never overwrites.

import { useState } from "react";

import { railRow, railRowCols } from "@/components/SendToDoc";
import { useToast } from "@/components/Toasts";

export default function SendToDrive({ runId, variant = "button" }: { runId: number; variant?: "button" | "row" }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The rail row has no room for the reason, so failures also go to a toast.
  const fail = (text: string) => { setErr(text); push(`Drive: ${text}`); };

  async function send() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/gdrive/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { fail(data.error ?? `Failed (${res.status})`); return; }
      const bits = [
        `${data.uploaded} uploaded`,
        data.skipped ? `${data.skipped} already there` : null,
        data.createdFolder ? `folder “${data.folder}” created` : `into “${data.folder}”`,
      ].filter(Boolean).join(" · ");
      setMsg(bits + (data.errors?.length ? ` · ${data.errors.length} failed` : ""));
      if (data.errors?.length) fail(data.errors.map((e: { name: string; detail?: string }) => `${e.name}: ${e.detail ?? "failed"}`).join(" | ").slice(0, 300));
      else push(`Drive: ${bits}`, "success");
    } catch (e) {
      fail(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "row") {
    return (
      <>
        <button onClick={send} disabled={busy} className={railRow} style={railRowCols} title={err ?? msg ?? "Upload the finished images to the product's Drive folder"}>
          <span className="text-[13px] font-[500] text-[var(--color-text)]">Drive</span>
          <span className="ff-mono text-[11px]" style={{ color: err ? "var(--color-red)" : msg ? "var(--color-green)" : "var(--color-text-3)" }}>{busy ? "sending…" : err ? "failed" : msg ? "sent" : "ready"}</span>
        </button>
        {err && <p className="px-2.5 text-[11px] leading-snug text-[var(--color-red)] break-words">{err}</p>}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={send}
        disabled={busy}
        className="btn btn-sm"
      >
        {busy ? "Sending to Drive…" : "Send images to Drive"}
      </button>
      {msg && <span className="text-[11px] text-[var(--color-green)]">{msg}</span>}
      {err && <span className="text-[11px] text-[var(--color-red)]">{err}</span>}
    </div>
  );
}
