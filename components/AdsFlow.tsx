"use client";

// Stage 5 · Image ads. Write five briefs (premise + headline + prompt, one per
// concept) → operator edits/approves → generate 1:1 images through the same
// Higgsfield + auditor path as Stage 4 → review, regenerate per ad, send to
// the product's "Image Ads" Drive folder.

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { Run } from "@/lib/db";
import { parseAdImages, parseAdPrompts, type AdImage, type AdPrompt } from "@/lib/ads/shape";
import { parseProductScrape } from "@/lib/product";

type Cand = { url: string; tag: string };

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
const effVerdict = (im: AdImage | undefined): "pass" | "fail" | null => (im ? im.user_override ?? im.verdict ?? null : null);

export default function AdsFlow({ runId }: { runId: number }) {
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [drafts, setDrafts] = useState<AdPrompt[] | null>(null);
  const [images, setImages] = useState<AdImage[]>([]);
  const [refOverrides, setRefOverrides] = useState<Record<string, string[]>>({});
  const [genBusy, setGenBusy] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [openPrompt, setOpenPrompt] = useState<Set<number>>(new Set());
  const [aiIdx, setAiIdx] = useState<number | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const [regenText, setRegenText] = useState("");
  const [lb, setLb] = useState<string | null>(null);
  const [drive, setDrive] = useState<{ busy: boolean; msg: string | null; err: string | null }>({ busy: false, msg: null, err: null });
  const [zipping, setZipping] = useState(false);
  const stopRef = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const fetchRun = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${runId}`).then((x) => x.json());
      if (r?.run) {
        const rr = r.run as Run;
        setRun(rr);
        setImages(parseAdImages(rr.ads_images));
        setRefOverrides(safeParse<Record<string, string[]>>(rr.ads_ref_overrides, {}));
        setDrafts((prev) => prev ?? (parseAdPrompts(rr.ads_prompts_edited ?? rr.ads_prompts).length ? parseAdPrompts(rr.ads_prompts_edited ?? rr.ads_prompts) : null));
        window.dispatchEvent(new Event("run:changed"));
      }
    } catch { /* keep the last copy */ }
  }, [runId]);
  useEffect(() => { void fetchRun(); }, [fetchRun]);
  useEffect(() => {
    if (run?.ads_step !== "writing") return;
    const t = setInterval(fetchRun, 4000);
    return () => clearInterval(t);
  }, [run?.ads_step, fetchRun]);

  const patch = (body: Record<string, unknown>) => {
    chain.current = chain.current.catch(() => {}).then(() =>
      fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async (r) => { if (!r.ok) { const d = await r.json().catch(() => ({})); setErr((d as { error?: string }).error || `Save failed (${r.status})`); } }),
    );
    return chain.current;
  };
  const persistImage = (image: AdImage, step?: string) => patch({ type: "ads_image_upsert", image, ...(step ? { ads_step: step } : {}) });

  if (!run) return <p className="ff-mono text-[11px] text-[var(--color-text-3)]">Loading Stage 5…</p>;

  const step = run.ads_step ?? null;
  const productDesc = run.product_description ?? run.product_name ?? "";
  const hero = run.stage3_hero_image_url ?? null;

  // Every photo the run has, as reference candidates: hero first, then the
  // operator's uploads, then everything the scrape read.
  const scrape = parseProductScrape(run.product_scrape);
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, tag: string) => { if (url && !seen.has(url)) { seen.add(url); cands.push({ url, tag }); } };
  add(hero, "hero");
  // Stage 4's finished images — the scenes the ads should reuse.
  try {
    const rem = JSON.parse(run.stage3_remaining_images ?? "[]") as Array<{ index?: number; category?: string; image_url?: string; status?: string }>;
    rem
      .filter((im) => im?.image_url && im.status === "done")
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .forEach((im) => add(im.image_url, "stage 4"));
  } catch { /* none */ }
  safeParse<string[]>(run.uploaded_source_images, []).forEach((u) => add(u, "yours"));
  (scrape?.pages ?? []).forEach((p) => {
    p.image_urls?.forEach((u) => add(u, p.role === "product" ? "listing" : "comp"));
    p.description_image_urls?.forEach((u) => add(u, "desc"));
  });
  const refsFor = (p: AdPrompt) => refOverrides[String(p.index)] ?? p.source_image_references ?? [];

  /* ── write ─────────────────────────────────────────────────────────── */
  const write = async () => {
    setWriting(true); setErr(null);
    try {
      const r = await fetch("/api/ads/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || `Failed (${r.status})`); return; }
      setDrafts(d.prompts as AdPrompt[]);
      setImages([]);
      await fetchRun();
    } catch (e) { setErr(e instanceof Error ? e.message : "Network error"); }
    finally { setWriting(false); }
  };

  /* ── edit briefs ───────────────────────────────────────────────────── */
  const updateDraft = (index: number, patchP: Partial<AdPrompt>, save = false) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.map((p) => (p.index === index ? { ...p, ...patchP } : p));
      if (save) void patch({ ads_prompts_edited: JSON.stringify(next) });
      return next;
    });
  };
  const saveDrafts = () => { if (drafts) void patch({ ads_prompts_edited: JSON.stringify(drafts) }); };
  const toggleRef = (p: AdPrompt, url: string) => {
    const cur = refsFor(p);
    const next = cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url].slice(0, 6);
    const merged = { ...refOverrides, [String(p.index)]: next };
    setRefOverrides(merged);
    void patch({ ads_ref_overrides: JSON.stringify(merged) });
  };
  const aiRewrite = async (p: AdPrompt) => {
    if (aiText.trim().length < 5) return;
    setAiBusy(true); setErr(null);
    try {
      const r = await fetch("/api/stage3/edit-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p.prompt, instructions: aiText.trim(), category: `ad_${p.concept}`, reference_images: refsFor(p), run_id: runId }),
      });
      const d = await r.json();
      if (!d.success || !d.prompt) { setErr(d.error || `Rewrite failed (${r.status})`); return; }
      updateDraft(p.index, { prompt: d.prompt as string }, true);
      setAiIdx(null); setAiText("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Network error"); }
    finally { setAiBusy(false); }
  };

  /* ── generate ──────────────────────────────────────────────────────── */
  const generateOne = async (p: AdPrompt, promptText: string, keepHistoryOf?: AdImage) => {
    setGenBusy((s) => new Set(s).add(p.index));
    const refs = refsFor(p);
    try {
      const gen = await fetch("/api/stage3/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, model: p.model || "gpt_image_2", reference_images: refs, aspect_ratio: "1:1" }),
      }).then((r) => r.json());
      if (!gen.success) throw new Error(gen.error || "generation failed");
      let verdict: "pass" | "fail" = "pass";
      let issues: string[] = [];
      try {
        const audit = await fetch("/api/stage3/audit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: gen.image_url, category: `ad_${p.concept}`, prompt_used: promptText, product_description: productDesc, overlay_text_used: p.headline || null, reference_urls: refs, run_id: runId }),
        }).then((r) => r.json());
        if (audit.success) { verdict = audit.result?.verdict === "pass" ? "pass" : "fail"; issues = audit.result?.issues ?? []; }
        else issues = ["Audit skipped (auditor unavailable) — review manually."];
      } catch { issues = ["Audit skipped (network error) — review manually."]; }
      const history = [
        ...(keepHistoryOf?.image_url ? [{ image_url: keepHistoryOf.image_url, prompt: p.prompt }] : []),
        ...(keepHistoryOf?.history ?? []),
      ].slice(0, 5);
      const updated: AdImage = { index: p.index, concept: p.concept, image_url: gen.image_url, status: "done", verdict, issues, user_override: null, history };
      setImages((prev) => [...prev.filter((x) => x.index !== p.index), updated].sort((a, b) => a.index - b.index));
      await persistImage(updated);
    } catch (e) {
      const failed: AdImage = { index: p.index, concept: p.concept, image_url: keepHistoryOf?.image_url ?? "", status: "failed", error: e instanceof Error ? e.message : String(e), history: keepHistoryOf?.history };
      setImages((prev) => [...prev.filter((x) => x.index !== p.index), failed].sort((a, b) => a.index - b.index));
      await persistImage(failed);
    } finally {
      setGenBusy((s) => { const n = new Set(s); n.delete(p.index); return n; });
    }
  };
  const generateAll = async (onlyMissing: boolean) => {
    if (!drafts) return;
    setErr(null); setGenerating(true); stopRef.current = false;
    await patch({ ads_prompts_edited: JSON.stringify(drafts), ads_step: "generating" });
    const targets = drafts.filter((p) => !onlyMissing || !images.some((im) => im.index === p.index && im.status === "done" && im.image_url));
    const queue = [...targets];
    const worker = async () => { while (queue.length && !stopRef.current) { const p = queue.shift()!; await generateOne(p, p.prompt); } };
    await Promise.all([worker(), worker()]);
    await patch({ ads_step: "done" });
    setGenerating(false);
    await fetchRun();
  };
  const regenerate = async (p: AdPrompt, useAi: boolean) => {
    const cur = images.find((im) => im.index === p.index);
    let promptText = p.prompt;
    setRegenIdx(null);
    if (useAi && regenText.trim().length >= 5) {
      setGenBusy((s) => new Set(s).add(p.index));
      try {
        const r = await fetch("/api/stage3/edit-prompt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: p.prompt, instructions: regenText.trim(), category: `ad_${p.concept}`, reference_images: refsFor(p), run_id: runId }),
        });
        const d = await r.json();
        if (!d.success || !d.prompt) { setErr(d.error || `Rewrite failed (${r.status})`); return; }
        promptText = d.prompt as string;
        updateDraft(p.index, { prompt: promptText }, true);
      } catch (e) { setErr(e instanceof Error ? e.message : "Network error"); return; }
      finally { setGenBusy((s) => { const n = new Set(s); n.delete(p.index); return n; }); }
    }
    await generateOne(p, promptText, cur);
  };
  const restorePrevious = async (p: AdPrompt) => {
    const cur = images.find((im) => im.index === p.index);
    const prev = cur?.history?.[0];
    if (!cur || !prev) return;
    const updated: AdImage = { ...cur, image_url: prev.image_url, status: "done", verdict: undefined, issues: [], user_override: null,
      history: [{ image_url: cur.image_url, prompt: p.prompt }, ...(cur.history ?? []).slice(1)].slice(0, 5) };
    setImages((prevImgs) => prevImgs.map((x) => (x.index === p.index ? updated : x)));
    await persistImage(updated);
    if (prev.prompt) updateDraft(p.index, { prompt: prev.prompt }, true);
  };
  const toggleVerdict = (p: AdPrompt) => {
    const cur = images.find((im) => im.index === p.index);
    if (!cur) return;
    const auto = cur.verdict ?? "pass";
    const o = cur.user_override ?? null;
    let next: "pass" | "fail" | null;
    if (o === null) next = auto === "pass" ? "fail" : "pass";
    else { const flip = o === "pass" ? "fail" : "pass"; next = flip === auto ? null : flip; }
    const updated = { ...cur, user_override: next };
    setImages((prev) => prev.map((x) => (x.index === p.index ? updated : x)));
    void persistImage(updated);
  };

  /* ── deliver ───────────────────────────────────────────────────────── */
  const sendToDrive = async () => {
    setDrive({ busy: true, msg: null, err: null });
    try {
      const r = await fetch("/api/gdrive/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, kind: "ads" }) });
      const d = await r.json();
      if (!d.success) { setDrive({ busy: false, msg: null, err: d.error || `Failed (${r.status})` }); return; }
      setDrive({ busy: false, msg: `${d.uploaded} uploaded${d.skipped ? ` · ${d.skipped} already there` : ""} · Image Ads in “${d.folder}”`, err: d.errors?.length ? `${d.errors.length} failed` : null });
    } catch (e) { setDrive({ busy: false, msg: null, err: e instanceof Error ? e.message : "Network error" }); }
  };
  const downloadAll = async () => {
    const done = images.filter((im) => im.status === "done" && im.image_url);
    if (!done.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const im of done) {
        const blob = await fetch(im.image_url).then((r) => r.blob());
        zip.file(`ad-${im.index}-${im.concept}.png`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(out); a.download = `run-${runId}-ads.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Download failed"); }
    finally { setZipping(false); }
  };

  /* ── render ────────────────────────────────────────────────────────── */
  const doneCount = images.filter((im) => im.status === "done" && im.image_url).length;
  const anyBusy = generating || genBusy.size > 0;

  if (run.status !== "completed" && !drafts) {
    return <p className="text-[13px] text-[var(--color-text-2)]">Starts after Stage 4 is complete.</p>;
  }
  if (!drafts) {
    return (
      <div className="space-y-3">
        {step === "writing" || writing
          ? <p className="ff-mono text-[11px] text-[var(--color-text-3)]">Writing the five briefs…</p>
          : <button onClick={write} className="btn btn-primary">Write 5 ads</button>}
        {(err || run.ads_error) && <p className="text-[12px] text-[var(--color-red)]">{err ?? run.ads_error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{doneCount} / 5 generated{images.some((im) => effVerdict(im) === "fail") ? ` · ${images.filter((im) => effVerdict(im) === "fail").length} flagged` : ""}</span>
        <div className="flex-1" />
        {doneCount > 0 && <button onClick={downloadAll} disabled={zipping} className="btn btn-sm">{zipping ? "Zipping…" : "↓ Download all"}</button>}
        {doneCount > 0 && <button onClick={sendToDrive} disabled={drive.busy} className="btn btn-sm">{drive.busy ? "Sending…" : "Send to Drive · Image Ads"}</button>}
        {anyBusy
          ? <button onClick={() => { stopRef.current = true; }} className="btn btn-sm">Stop after current</button>
          : doneCount === 0
            ? <button onClick={() => generateAll(false)} className="btn btn-primary">Generate 5 ads</button>
            : doneCount < 5
              ? <button onClick={() => generateAll(true)} className="btn btn-primary">Generate the missing {5 - doneCount}</button>
              : <button onClick={() => { if (window.confirm("Regenerate all five ads from the current briefs?")) void generateAll(false); }} className="btn btn-sm">Regenerate all 5</button>}
      </div>
      {(drive.msg || drive.err) && <p className={`text-[12px] ${drive.err ? "text-[var(--color-red)]" : "text-[var(--color-green)]"}`}>{drive.msg}{drive.err ? ` · ${drive.err}` : ""}</p>}
      {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))" }}>
        {drafts.map((p) => {
          const im = images.find((x) => x.index === p.index);
          const v = effVerdict(im);
          const busy = genBusy.has(p.index);
          const refs = refsFor(p);
          return (
            <div key={p.index} className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] overflow-hidden">
              <div className="flex items-center gap-2 px-[13px] py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <span className="ff-mono text-[10px] text-[var(--color-text-4)]">{p.index}</span>
                <span className="text-[13px] font-[600] text-[var(--color-text)]">{p.concept_label}</span>
                <div className="flex-1" />
                {im && im.status === "done" && v && (
                  <button onClick={() => toggleVerdict(p)} title={im.user_override ? "Overridden — click to cycle" : `Auditor: ${im.verdict}. Click to override.`}
                    className={`ff-mono text-[9px] uppercase tracking-wide px-2 py-0.5 rounded-full text-white cursor-pointer ${v === "pass" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]"}`}>{v}{im.user_override ? "•" : ""}</button>
                )}
              </div>

              <div className="flex gap-3 p-[13px]">
                {/* image / placeholder */}
                <div className="w-[200px] shrink-0">
                  <div className={`aspect-square rounded-[9px] border overflow-hidden relative bg-[var(--color-surface-2)] ${v === "fail" || im?.status === "failed" ? "border-[var(--color-red)]/60" : "border-[var(--color-border)]"}`}>
                    {busy && (
                      <div className="absolute inset-0 z-20 grid place-items-center bg-black/60">
                        <span className="ff-mono text-[10px] uppercase tracking-wide text-white">Generating…</span>
                      </div>
                    )}
                    {im?.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={im.image_url} alt={p.concept_label} onClick={() => setLb(im.image_url)} className="w-full h-full object-cover cursor-zoom-in" />
                      : <div className="w-full h-full grid place-items-center ff-mono text-[10px] text-[var(--color-text-4)]">{im?.status === "failed" ? "failed" : "not generated"}</div>}
                  </div>
                  {im?.status === "failed" && im.error && <p className="mt-1 text-[10.5px] text-[var(--color-red)] leading-snug line-clamp-3">{im.error}</p>}
                  {im?.status === "done" && v === "fail" && im.issues?.length ? (
                    <ul className="mt-1 space-y-0.5">{im.issues.slice(0, 3).map((x) => <li key={x} className="text-[10.5px] text-[var(--color-red)] leading-snug">{x}</li>)}</ul>
                  ) : null}
                  {im?.image_url && !busy && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button onClick={() => { setRegenIdx(regenIdx === p.index ? null : p.index); setRegenText(im.issues?.length && v === "fail" ? `Fix the audit issues:\n- ${im.issues.join("\n- ")}` : ""); }} className="btn btn-sm">Regenerate</button>
                      <a href={im.image_url} download={`ad-${p.index}-${p.concept}.png`} target="_blank" rel="noreferrer" className="btn btn-sm">↓</a>
                      {im.history?.[0] && <button onClick={() => restorePrevious(p)} className="btn btn-sm" title="Bring back the previous version">Previous</button>}
                    </div>
                  )}
                  {!im?.image_url && !busy && doneCount > 0 && !anyBusy && (
                    <button onClick={() => generateOne(p, p.prompt)} className="btn btn-sm mt-2">Generate this one</button>
                  )}
                  {regenIdx === p.index && (
                    <div className="mt-2 space-y-1.5">
                      <textarea value={regenText} onChange={(e) => setRegenText(e.target.value)} rows={3} placeholder="What to change (leave empty to re-roll)"
                        className="w-full px-2 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[11.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]" />
                      <div className="flex gap-1.5">
                        <button onClick={() => regenerate(p, regenText.trim().length >= 5)} className="btn btn-sm btn-primary">{regenText.trim().length >= 5 ? "Rewrite & regenerate" : "Regenerate as is"}</button>
                        <button onClick={() => setRegenIdx(null)} className="btn btn-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* brief */}
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div>
                    <span className="eyebrow">Premise</span>
                    <textarea value={p.premise} onChange={(e) => updateDraft(p.index, { premise: e.target.value })} onBlur={saveDrafts} rows={4}
                      className="mt-1 w-full px-2.5 py-2 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[12.5px] leading-[1.5] text-[var(--color-text)] outline-none resize-y focus:border-[var(--color-border-strong)]" />
                  </div>
                  <div>
                    <span className="eyebrow">Headline on the image</span>
                    <input value={p.headline} onChange={(e) => updateDraft(p.index, { headline: e.target.value })} onBlur={saveDrafts}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[13px] font-[500] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]" />
                  </div>
                  <p className="ff-mono text-[10.5px] text-[var(--color-text-3)]">proof: {p.proof || "none"}</p>
                  <div>
                    <button onClick={() => setOpenPrompt((s) => { const n = new Set(s); if (n.has(p.index)) n.delete(p.index); else n.add(p.index); return n; })} className="eyebrow cursor-pointer hover:text-[var(--color-text)]">
                      Prompt {openPrompt.has(p.index) ? "▾" : "▸"}
                    </button>
                    {openPrompt.has(p.index) && (
                      <div className="mt-1 space-y-1.5">
                        <textarea value={p.prompt} onChange={(e) => updateDraft(p.index, { prompt: e.target.value })} onBlur={saveDrafts} rows={12}
                          className="w-full px-2.5 py-2 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] ff-mono text-[11px] leading-[1.5] text-[var(--color-text)] outline-none resize-y focus:border-[var(--color-border-strong)]" />
                        {aiIdx === p.index ? (
                          <div className="flex gap-1.5 items-start">
                            <input value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="What to change in this prompt" autoFocus
                              className="flex-1 px-2.5 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]" />
                            <button onClick={() => aiRewrite(p)} disabled={aiBusy || aiText.trim().length < 5} className="btn btn-sm btn-primary">{aiBusy ? "Rewriting…" : "Rewrite"}</button>
                            <button onClick={() => { setAiIdx(null); setAiText(""); }} className="btn btn-sm">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => { setAiIdx(p.index); setAiText(""); }} className="btn btn-sm">Edit with AI</button>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="eyebrow">References <span className="text-[var(--color-text-4)] font-[500] normal-case tracking-normal">— {refs.length} picked</span></span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {cands.map((c) => {
                        const on = refs.includes(c.url);
                        return (
                          <button key={c.url} onClick={() => toggleRef(p, c.url)} title={c.tag}
                            className={`relative w-[52px] h-[52px] rounded-[6px] overflow-hidden border-2 bg-[var(--color-surface-2)] cursor-pointer ${on ? "border-[var(--color-accent)]" : "border-transparent opacity-60 hover:opacity-100"}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.url} alt="" loading="lazy" className="w-full h-full object-contain" />
                            <span className="absolute bottom-0 left-0 right-0 ff-mono text-[7.5px] uppercase text-center bg-black/55 text-white">{c.tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {lb && (
        <div className="fixed inset-0 z-50 bg-black/85 grid place-items-center cursor-zoom-out" onClick={() => setLb(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lb} alt="" className="max-w-[92vw] max-h-[92vh] object-contain" />
        </div>
      )}
    </div>
  );
}
