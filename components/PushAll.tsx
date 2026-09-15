"use client";

import { useState } from "react";

// One button on the Done screen: Shopify push, Google Doc, Drive (images and
// ads), in that order, each reported on its own line. Everything it calls is
// the same route the individual buttons call, with the same guards: nothing
// is published, deleted or priced.
type Line = { name: string; state: "waiting" | "running" | "done" | "skipped" | "failed"; note?: string };

export default function PushAll({ runId, productUrl, hasDocs, hasImages, hasAds, onDone }: {
  runId: number;
  productUrl: string | null;
  hasDocs: boolean;
  hasImages: boolean;
  hasAds: boolean;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const set = (name: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.name === name ? { ...l, ...patch } : l)));

  async function run() {
    const plan = [
      hasImages ? (productUrl ? "Shopify: title, copy fields and images on the saved product" : "Shopify: skipped, no product link saved") : "Shopify: skipped, no images yet",
      hasDocs ? "Google Doc: the copy into the product's tab" : "Google Doc: skipped, no copy yet",
      hasImages || hasAds ? `Drive: ${[hasImages ? "images" : null, hasAds ? "ads" : null].filter(Boolean).join(" and ")}` : "Drive: skipped, nothing finished",
    ];
    if (!window.confirm(`Push everything?\n\n${plan.join("\n")}`)) return;
    setBusy(true);
    setLines([{ name: "Shopify", state: "waiting" }, { name: "Google Doc", state: "waiting" }, { name: "Drive", state: "waiting" }]);

    // Shopify
    if (!hasImages) set("Shopify", { state: "skipped", note: "no images yet" });
    else if (!productUrl) set("Shopify", { state: "skipped", note: "no product link saved" });
    else {
      set("Shopify", { state: "running" });
      try {
        const res = await fetch("/api/shopify/fill", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, productUrl, includeTitle: true, dryRun: false }),
        });
        const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string; warning?: string; report?: { fields?: Array<{ status?: string }>; images?: { toAdd?: unknown[] } } };
        if (!d.success) set("Shopify", { state: "failed", note: d.error ?? `failed (${res.status})` });
        else {
          const setCount = d.report?.fields?.filter((f) => f.status === "set").length;
          const imgs = d.report?.images?.toAdd?.length;
          set("Shopify", { state: "done", note: [setCount != null ? `${setCount} fields` : null, imgs ? `${imgs} images` : null, d.warning ?? null].filter(Boolean).join(" · ") || undefined });
        }
      } catch (e) { set("Shopify", { state: "failed", note: e instanceof Error ? e.message : "network error" }); }
    }

    // Google Doc — a 409 means it was sent before; send again explicitly.
    if (!hasDocs) set("Google Doc", { state: "skipped", note: "no copy yet" });
    else {
      set("Google Doc", { state: "running" });
      try {
        let res = await fetch("/api/gdoc/append", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, force: false }) });
        if (res.status === 409) res = await fetch("/api/gdoc/append", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, force: true }) });
        const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
        if (!d.success) set("Google Doc", { state: "failed", note: d.error ?? `failed (${res.status})` });
        else set("Google Doc", { state: "done" });
      } catch (e) { set("Google Doc", { state: "failed", note: e instanceof Error ? e.message : "network error" }); }
    }

    // Drive — each half in its own subfolder; a half the run lacks is skipped.
    const wanted = [hasImages ? "images" : null, hasAds ? "ads" : null].filter((x): x is "images" | "ads" => !!x);
    if (!wanted.length) set("Drive", { state: "skipped", note: "nothing finished" });
    else {
      set("Drive", { state: "running" });
      const parts: string[] = []; const problems: string[] = [];
      for (const which of wanted) {
        try {
          const res = await fetch("/api/gdrive/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, kind: which }) });
          const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string; uploaded?: number; replaced?: number; skipped?: number; subfolder?: string };
          if (!res.ok || !d.success) throw new Error(d.error ?? `failed (${res.status})`);
          parts.push(`${d.subfolder ?? (which === "ads" ? "Image Ads" : "Images")}: ${[`${d.uploaded ?? 0} uploaded`, d.replaced ? `${d.replaced} replaced` : null, d.skipped ? `${d.skipped} already there` : null].filter(Boolean).join(", ")}`);
        } catch (e) { problems.push(`${which}: ${e instanceof Error ? e.message : "network error"}`); }
      }
      set("Drive", { state: problems.length && !parts.length ? "failed" : "done", note: [...parts, ...problems].join(" · ") || undefined });
    }

    setBusy(false);
    onDone?.();
  }

  const tone: Record<Line["state"], string> = { waiting: "var(--color-text-4)", running: "var(--color-accent)", done: "var(--color-green)", skipped: "var(--color-text-3)", failed: "var(--color-red)" };
  const word: Record<Line["state"], string> = { waiting: "—", running: "sending…", done: "done", skipped: "skipped", failed: "failed" };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={run} disabled={busy} className="btn btn-primary cursor-pointer">{busy ? "Pushing…" : "Push to all"}</button>
      {lines.length > 0 && (
        <ul className="ff-mono text-[11px] text-right space-y-0.5">
          {lines.map((l) => (
            <li key={l.name}>
              <span className="text-[var(--color-text-2)]">{l.name}</span> <span style={{ color: tone[l.state] }}>{word[l.state]}</span>
              {l.note ? <span className="text-[var(--color-text-3)]"> · {l.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
