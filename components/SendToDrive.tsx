"use client";

// Uploads a run's finished work into the product's Drive folder (created on
// first send): the hero + the 8 into Images, and the five Stage 5 ads into
// that week's "Image Ads Wnn". kind="both" (the default) does whichever of
// the two the run actually has, in one click. Images are append-only; a
// regenerated ad replaces its file.

import { useState } from "react";

import { railRow, railRowCols } from "@/components/SendToDoc";
import { useToast } from "@/components/Toasts";

export default function SendToDrive({ runId, variant = "button", kind = "both", label, hasImages = true, hasAds = true }: {
  runId: number;
  variant?: "button" | "row";
  kind?: "images" | "ads" | "both";
  /** Row label; defaults to "Drive". */
  label?: string;
  /** What this run actually has, so a combined send skips the empty half. */
  hasImages?: boolean;
  hasAds?: boolean;
}) {
  const rowLabel = label ?? (kind === "ads" ? "Drive · ads" : "Drive");
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The rail row has no room for the reason, so failures also go to a toast.
  const fail = (text: string) => { setErr(text); push(`Drive: ${text}`); };

  const sendOne = async (which: "images" | "ads") => {
    const res = await fetch("/api/gdrive/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, kind: which }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error ?? `Failed (${res.status})`);
    return data as { uploaded: number; replaced?: number; skipped: number; folder: string; subfolder?: string; errors?: Array<{ name: string; detail?: string }> };
  };

  async function send() {
    setBusy(true); setErr(null); setMsg(null);
    // One click covers both halves; each lands in its own subfolder, and a
    // half the run doesn't have yet is simply skipped.
    const wanted: Array<"images" | "ads"> =
      kind === "both" ? ([hasImages ? "images" : null, hasAds ? "ads" : null].filter(Boolean) as Array<"images" | "ads">) : [kind];
    if (!wanted.length) { fail("Nothing finished to send yet."); setBusy(false); return; }
    const parts: string[] = [];
    const problems: string[] = [];
    for (const which of wanted) {
      try {
        const d = await sendOne(which);
        const counts = [
          `${d.uploaded} uploaded`,
          d.replaced ? `${d.replaced} replaced` : null,
          d.skipped ? `${d.skipped} already there` : null,
        ].filter(Boolean).join(", ");
        parts.push(`${d.subfolder ?? (which === "ads" ? "Image Ads" : "Images")}: ${counts}`);
        if (d.errors?.length) problems.push(d.errors.map((e) => `${e.name}: ${e.detail ?? "failed"}`).join(" | "));
      } catch (e) {
        problems.push(`${which}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    const summary = parts.join(" · ");
    if (parts.length) setMsg(summary);
    if (problems.length) fail(problems.join(" | ").slice(0, 300));
    else if (parts.length) push(`Drive: ${summary}`, "success");
    setBusy(false);
  }

  if (variant === "row") {
    return (
      <>
        <button onClick={send} disabled={busy} className={railRow} style={railRowCols} title={err ?? msg ?? undefined}>
          <span className="text-[13px] font-[500] text-[var(--color-text)]">{rowLabel}</span>
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
        {busy ? "Sending to Drive…" : kind === "ads" ? "Send ads to Drive" : kind === "images" ? "Send images to Drive" : "Send to Drive"}
      </button>
      {msg && <span className="text-[11px] text-[var(--color-green)]">{msg}</span>}
      {err && <span className="text-[11px] text-[var(--color-red)]">{err}</span>}
    </div>
  );
}
