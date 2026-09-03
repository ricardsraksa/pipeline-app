"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/db";
import Stage3ReferenceImages from "@/components/Stage3ReferenceImages";
import Stage3SourcePicker from "@/components/Stage3SourcePicker";
import { parseProductScrape, productCandidateImages } from "@/lib/product";
import ShopifyFill from "@/components/ShopifyFill";
import SendToDrive from "@/components/SendToDrive";

/* ── types mirrored from lib/stage3/hero.ts (kept local so this stays a
      pure client component without importing server code) ──────────────── */
interface HeroPrompt {
  model: string;
  aspect_ratio: string;
  prompt: string;
  source_image_references: string[];
}
interface RemainingPrompt {
  index: number;
  image_type: string;
  category: string;
  model: string;
  aspect_ratio: string;
  prompt: string;
  overlay_text: string;
  source_image_references: string[];
}
interface RemImage {
  index: number;
  category: string;
  image_url: string;
  status: "done" | "failed";
  error?: string;
  verdict?: "pass" | "fail";
  issues?: string[];
  /** Operator override of the auditor's verdict. Wins over `verdict`. */
  user_override?: "pass" | "fail" | null;
  /** Previous versions of this image (newest first), kept when regenerating so
   *  the operator can go back — each with the prompt that produced it. */
  history?: Array<{ image_url: string; prompt?: string }>;
}

/** One saved version of a card's prompt. */
interface PromptVersion {
  prompt: string;
  at: string;
  source: "written" | "edited" | "ai";
}

interface Placement {
  /** Legacy — old runs auto-placed section 1 too; it is now always manual (GIF). */
  section_1?: number;
  section_2: number;
  section_3: number;
  reasons?: Record<string, string>;
}

function effVerdict(im: RemImage | null | undefined): "pass" | "fail" | null {
  if (!im) return null;
  const v = im.user_override ?? im.verdict;
  return v === "pass" ? "pass" : v === "fail" ? "fail" : null;
}

// Why an image is in the fix list: a hard generation error and/or the auditor's
// flagged issues, de-duplicated. Drives both the bulk-fix reasons display and
// the per-image rewrite instruction.
function reasonsFor(im: RemImage): string[] {
  const all = [im.error, ...(im.issues ?? [])].map((s) => (s ?? "").trim()).filter(Boolean);
  return Array.from(new Set(all));
}

// Human-readable label for each Stage 4 image template, so the operator knows
// which part of the copy each image pairs with.
const CATEGORY_LABELS: Record<string, string> = {
  hero: "Hero shot",
  lifestyle: "Lifestyle",
  problem_solution: "Problem → Solution",
  feature_callout: "Feature callout",
  benefit_visualization: "Benefit",
  before_after: "Before / After",
  comparison: "Comparison",
  ugc_native: "UGC / Native",
  review_social_proof: "Review / Social proof",
};
function catLabel(slug: string | undefined): string {
  if (!slug) return "Image";
  return CATEGORY_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const btnPrimary =
  "cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-50";

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

export default function Stage3HeroFlow({
  runId,
  stage2Ready,
}: {
  runId: number;
  /** Stage 3 is done — Stage 4 is allowed to start. */
  stage2Ready: boolean;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hero QC local edit state
  const [heroEditing, setHeroEditing] = useState(false);
  const [heroDraft, setHeroDraft] = useState("");
  // AI-assisted hero-prompt edit ("tell Claude what to change")
  const [heroAiInstr, setHeroAiInstr] = useState("");
  const [heroAiLoading, setHeroAiLoading] = useState(false);
  const [heroAiErr, setHeroAiErr] = useState<string | null>(null);

  async function rewriteHeroWithAi() {
    const instr = heroAiInstr.trim();
    if (instr.length < 5) { setHeroAiErr("Tell Claude what to change (5+ characters)"); return; }
    setHeroAiLoading(true);
    setHeroAiErr(null);
    try {
      const res = await fetch("/api/stage3/edit-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: heroDraft, instructions: instr, category: "hero_studio", reference_images: safeParse<string[]>(run?.stage3_reference_images, []), run_id: runId }),
      });
      const data = await res.json();
      if (!data.success || !data.prompt) { setHeroAiErr(data.error ?? `HTTP ${res.status}`); return; }
      const rewritten = data.prompt as string;
      setHeroDraft(rewritten);
      setHeroAiInstr("");
      // Rewriting is only ever a step toward a new hero — regenerate with the
      // rewritten prompt immediately instead of waiting for a second click.
      // (On a rewrite failure we return above and never regenerate.)
      setHeroEditing(false);
      await trigger("/api/stage3/hero-regenerate", { runId, editedPrompt: rewritten }, "regen-hero");
    } catch (e) {
      setHeroAiErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setHeroAiLoading(false);
    }
  }

  // Prompt QC local edit state (8 derivative prompts)
  const [promptDrafts, setPromptDrafts] = useState<RemainingPrompt[] | null>(null);
  // Generation progress for the 8
  const [genImages, setGenImages] = useState<(RemImage | null)[]>([]);
  const [heroZoom, setHeroZoom] = useState(false);
  // Prompt-review gate: which cards have their full prompt expanded for editing.
  const [editingPromptIdxs, setEditingPromptIdxs] = useState<Set<number>>(new Set());
  // Prompt-review gate: per-card "Edit with AI" (rewrite the prompt from a
  // natural-language note BEFORE any image is generated). One open at a time.
  const [aiCardIdx, setAiCardIdx] = useState<number | null>(null);
  const [aiCardText, setAiCardText] = useState("");
  const [aiCardBusy, setAiCardBusy] = useState(false);
  const [aiCardErr, setAiCardErr] = useState<string | null>(null);
  // Per-image reference overrides (prompt index → urls). Local edits shadow the
  // persisted value until the next run refetch.
  const [refOverrides, setRefOverrides] = useState<Record<string, string[]> | null>(null);
  // Stop flag for the client-side 8-image loop (the run-page "Kill run" only
  // reaches server stages; this loop runs in the browser).
  const stopRef = useRef(false);

  const fetchRun = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${runId}`).then((x) => x.json());
      if (r.run) setRun(r.run as Run);
    } catch { /* transient */ }
  }, [runId]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  const status = run?.status ?? "";
  // Poll while the server is doing background work.
  useEffect(() => {
    const active = status === "generating_hero" || status === "generating_remaining";
    if (!active) return;
    pollRef.current = setInterval(fetchRun, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, fetchRun]);

  async function trigger(url: string, body: Record<string, unknown>, label: string) {
    setErr(null);
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) setErr(data.error ?? `Request failed (${res.status})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
      await fetchRun();
    }
  }

  if (!run) {
    return <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading Stage 4…</p>;
  }

  // Source-image picker data: all candidate photos (uploaded + scraped, deduped)
  // and the operator's current exclusions. Mirrors lib/stage3/sources.ts.
  const srcUploaded = safeParse<string[]>(run.uploaded_source_images, []);
  const srcScraped = (() => {
    try {
      const sd = run.scraper_data ? JSON.parse(run.scraper_data) : null;
      return Array.isArray(sd?.images) ? (sd.images as unknown[]).filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  })();
  const sourceCandidates = [...srcUploaded, ...srcScraped].filter((u, i, a) => u && a.indexOf(u) === i);
  const sourceBlacklist = safeParse<string[]>(run.stage3_source_blacklist, []);
  // EVERY photo the run has — the whole Stage 1 scrape (listing gallery,
  // seller description images, competitor photos) plus the operator's own
  // uploads. The Stage 1 gate ticks a subset for research and for the prompt
  // writer; the per-image reference pickers below deliberately offer all of
  // them, because a shot often needs a photo that wasn't the ticked hero set.
  const allRunPhotos = productCandidateImages(parseProductScrape(run.product_scrape), srcUploaded);
  const GROUP_TAG: Record<string, string> = { uploaded: "YOURS", product: "LISTING", description: "DESC", competitor: "COMP" };

  const heroPrompt = safeParse<HeroPrompt | null>(run.stage3_hero_prompt, null);
  const heroPromptText = (run.stage3_hero_prompt_edited?.trim() || heroPrompt?.prompt || "");
  const heroUrl = run.stage3_hero_image_url;
  // Candidates offered by the per-image reference pickers: the approved hero,
  // the active source photos, and any operator scene references.
  const extraRefUrls = safeParse<string[]>(run.stage3_reference_images, []);
  const tickedSet = new Set(sourceCandidates.filter((u) => !sourceBlacklist.includes(u)));
  const refCandidates: RefCandidate[] = [
    ...(heroUrl ? [{ url: heroUrl, label: "HERO" }] : []),
    // ticked source photos first, then the rest of the run's photos
    ...sourceCandidates.filter((u) => tickedSet.has(u)).map((u) => ({ url: u, label: "SOURCE" })),
    ...allRunPhotos.filter((c) => !tickedSet.has(c.url)).map((c) => ({ url: c.url, label: GROUP_TAG[c.group] ?? "PHOTO" })),
    ...extraRefUrls.map((u) => ({ url: u, label: "REF" })),
  ].filter((c, i, a) => a.findIndex((x) => x.url === c.url) === i);
  const effRefOverrides = refOverrides ?? safeParse<Record<string, string[]>>(run.stage3_ref_overrides, {});
  // A prompt's current refs can include urls outside the base candidates (e.g.
  // a model-curated scraped photo) — surface those too so they stay toggleable.
  const candidatesFor = (p: RemainingPrompt): RefCandidate[] => {
    const cur = refsFor(p, effRefOverrides, heroUrl);
    const extra = cur.filter((u) => !refCandidates.some((c) => c.url === u)).map((u) => ({ url: u, label: "REF" }));
    return [...refCandidates, ...extra];
  };
  const toggleRefOverride = (p: RemainingPrompt, url: string) => {
    const cur = refsFor(p, effRefOverrides, heroUrl);
    const next = cur.includes(url) ? cur.filter((x) => x !== url) : [...cur, url];
    if (!next.length) { setErr("Each image needs at least one reference."); return; }
    setErr(null);
    const merged = { ...effRefOverrides, [String(p.index)]: next };
    setRefOverrides(merged);
    fetch(`/api/runs/${runId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage3_ref_overrides: JSON.stringify(merged) }),
    }).catch(() => {});
  };
  // Backward compat: a run completed under the OLD Stage 4 path stores its
  // images in `generated_images`. Treat that as "already has Stage 4" so we
  // don't offer the hero entry on a finished old run.
  const hasOldImages = !!run.generated_images;
  const heroFlowStarted =
    !!heroUrl ||
    ["generating_hero", "awaiting_hero_qc", "generating_remaining"].includes(status) ||
    !!run.stage3_remaining_prompts ||
    hasOldImages;

  /* ── ENTRY: start hero generation ───────────────────────────────────── */
  if (!heroFlowStarted) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--color-text-2)]">Hero shot first; the other 8 are built from it.</p>
        <Stage3SourcePicker runId={runId} candidates={sourceCandidates} blacklist={sourceBlacklist} onChanged={fetchRun} />
        {err && <ErrBox msg={err} />}
        <div className="flex gap-3 flex-wrap items-center">
          <button
            disabled={!stage2Ready || busy !== null}
            onClick={() => trigger("/api/stage3-hero-prompt", { runId }, "hero")}
            className={btnPrimary}
          >
            {busy === "hero" ? "Generating hero…" : "Generate hero →"}
          </button>
          <button
            disabled={!stage2Ready || busy !== null}
            onClick={() => trigger("/api/stage3/skip-hero", { runId }, "skip")}
            className={btnSecondary}
          >
            {busy === "skip" ? "Writing prompts…" : "Skip hero — use source images"}
          </button>
        </div>
        {!stage2Ready && <p className="text-[11px] text-[var(--color-text-3)]">Finish Stage 3 first.</p>}
      </div>
    );
  }

  /* ── generating_hero ─────────────────────────────────────────────────── */
  if (status === "generating_hero") {
    return <Spinner label="Generating the hero shot from your source photos…" />;
  }

  /* ── HERO QC GATE ────────────────────────────────────────────────────── */
  if (status === "awaiting_hero_qc" && heroUrl) {
    return (
      <div className="space-y-4">
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Review the hero shot</h3>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={heroUrl} alt="Hero" onClick={() => setHeroZoom(true)} title="Click to view fullscreen" className="rounded-lg max-w-md w-full border border-[var(--color-border)] cursor-zoom-in" />
        {heroZoom && <Lightbox items={[{ url: heroUrl, label: "Hero" }]} index={0} onClose={() => setHeroZoom(false)} onIndex={() => {}} />}
        <p className="text-[13px] text-[var(--color-text-2)] max-w-md">
          This hero becomes the reference for all other images. Make sure it matches the real product before continuing.
        </p>
        <ValidationBadge raw={run.stage3_hero_validation} />
        {err && <ErrBox msg={err} />}
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy !== null} onClick={() => trigger("/api/stage3/hero-approve", { runId }, "approve")} className={btnPrimary}>
            {busy === "approve" ? "Starting…" : "Approve Hero — Generate Rest →"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => { setHeroEditing((v) => !v); setHeroDraft(heroPromptText); }}
            className={btnSecondary}
          >
            {heroEditing ? "Cancel edit" : "Regenerate Hero"}
          </button>
        </div>

        {heroEditing && (
          <div className="space-y-3 max-w-2xl">
            {/* AI-assisted edit: describe a change, Claude rewrites the prompt. */}
            <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
              <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Edit with AI</label>
              <textarea
                value={heroAiInstr}
                onChange={(e) => setHeroAiInstr(e.target.value)}
                placeholder="e.g. warmer lighting, darker background, slight three-quarter angle"
                rows={2}
                disabled={heroAiLoading}
                className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
              />
              {heroAiErr && <p className="text-[11px] text-[var(--color-red)]">{heroAiErr}</p>}
              <button
                onClick={rewriteHeroWithAi}
                disabled={heroAiLoading || heroAiInstr.trim().length < 5}
                className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {heroAiLoading ? "Rewriting…" : "Rewrite & regenerate"}
              </button>
            </div>

            <Stage3SourcePicker runId={runId} candidates={sourceCandidates} blacklist={sourceBlacklist} onChanged={fetchRun} />

            <Stage3ReferenceImages runId={Number(runId)} initial={safeParse<string[]>(run.stage3_reference_images, [])} />
          </div>
        )}
      </div>
    );
  }

  /* ── generating_remaining (writing the 8 prompts) ───────────────────── */
  if (status === "generating_remaining") {
    return <Spinner label="Hero approved. Writing the 8 derivative prompts…" />;
  }

  /* ── PROMPT QC GATE (awaiting_qc, 8 prompts) ────────────────────────── */
  if (status === "awaiting_qc" && run.stage3_remaining_prompts) {
    const saved = promptDrafts ?? safeParse<RemainingPrompt[]>(
      run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts,
      [],
    );
    // Prompt history per card, newest first. The version the writer produced
    // is always the last entry, so "restore" can always get back to it.
    const history = safeParse<Record<string, PromptVersion[]>>(run.stage3_prompt_history, {});
    const original = safeParse<RemainingPrompt[]>(run.stage3_remaining_prompts, []);
    const versionsFor = (p: RemainingPrompt): PromptVersion[] => {
      const kept = history[String(p.index)] ?? [];
      const orig = original.find((o) => o.index === p.index)?.prompt;
      const hasOrig = orig && kept.some((v) => v.prompt === orig);
      return orig && !hasOrig ? [...kept, { prompt: orig, at: "", source: "written" as const }] : kept;
    };
    /** Push the current text into history before replacing it. */
    const pushHistory = (p: RemainingPrompt, source: PromptVersion["source"]) => {
      const key = String(p.index);
      const prev = (history[key] ?? []);
      if (prev[0]?.prompt === p.prompt) return history;
      const next = { ...history, [key]: [{ prompt: p.prompt, at: new Date().toISOString(), source }, ...prev].slice(0, 20) };
      void fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_prompt_history: JSON.stringify(next) }),
      }).catch((e) => console.error("persist prompt history failed:", e));
      return next;
    };
    const setDraft = (i: number, prompt: string) => {
      const next = saved.map((p, j) => (j === i ? { ...p, prompt } : p));
      setPromptDrafts(next);
    };
    const restoreVersion = (i: number, v: PromptVersion) => {
      pushHistory(saved[i], "edited");
      setDraft(i, v.prompt);
      setHistoryIdx(null);
      void fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_remaining_prompts_edited: JSON.stringify(saved.map((p, j) => (j === i ? { ...p, prompt: v.prompt } : p))) }),
      }).catch(() => undefined);
    };

    // Images already generated in a previous (interrupted) pass — the loop
    // skips these and resumes from the first missing one.
    const existing = safeParse<RemImage[]>(run.stage3_remaining_images, []);
    const doneByIndex = new Map(existing.filter((im) => im?.status === "done" && im.image_url).map((im) => [im.index, im]));

    // AI-rewrite one card's prompt from the operator's note. Only the prompt
    // text changes here — nothing generates until "Generate 8 Images".
    const aiRewriteCard = async (i: number) => {
      const instr = aiCardText.trim();
      if (instr.length < 5) { setAiCardErr("Describe the change (5+ characters)"); return; }
      setAiCardBusy(true);
      setAiCardErr(null);
      try {
        const res = await fetch("/api/stage3/edit-prompt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: saved[i].prompt, instructions: instr, category: saved[i].category, run_id: runId }),
        });
        const data = await res.json();
        if (!data.success || !data.prompt) { setAiCardErr(data.error ?? `HTTP ${res.status}`); return; }
        pushHistory(saved[i], "ai");
        setDraft(i, data.prompt as string);
        setAiCardIdx(null);
        setAiCardText("");
      } catch (e) {
        setAiCardErr(e instanceof Error ? e.message : "Network error");
      } finally {
        setAiCardBusy(false);
      }
    };

    const generateAll = async () => {
      setErr(null);
      setBusy("generate-8");
      const results: (RemImage | null)[] = saved.map((p) => doneByIndex.get(p.index) ?? null);
      setGenImages(results);
      // Persist any prompt edits first.
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_remaining_prompts_edited: JSON.stringify(saved) }),
      }).catch((e) => { console.error("persist prompt edits failed:", e); setErr("Couldn't save your prompt edits — generation continues with the edited text, but a refresh may show stale prompts."); });

      const productDesc = run.product_description ?? run.product_name ?? "";
      stopRef.current = false;

      // Generate one image: call Higgsfield, audit it, store + persist the
      // result. Pulled out of the loop so a worker pool can run several at once.
      const processOne = async (i: number) => {
        const p = saved[i];
        try {
          // Reference the image(s) this prompt was built around — the operator's
          // per-image selection when set, else the prompt's curated defaults.
          const refs = refsFor(p, effRefOverrides, heroUrl);
          const gen = await fetch("/api/stage3/generate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: p.prompt, model: p.model, reference_images: refs, aspect_ratio: p.aspect_ratio }),
          }).then((r) => r.json());
          if (!gen.success) throw new Error(gen.error || "generation failed");

          let verdict: "pass" | "fail" = "pass";
          let issues: string[] = [];
          try {
            const audit = await fetch("/api/stage3/audit", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_url: gen.image_url, category: p.category, prompt_used: p.prompt, product_description: productDesc, overlay_text_used: p.overlay_text || null, reference_urls: refs, run_id: runId }),
            }).then((r) => r.json());
            if (audit.success) {
              verdict = audit.result?.verdict === "pass" ? "pass" : "fail";
              issues = audit.result?.issues ?? [];
            } else {
              console.error("audit failed:", audit.error);
              issues = ["Audit skipped (auditor unavailable) — review manually."];
            }
          } catch (e) {
            console.error("audit call failed:", e);
            issues = ["Audit skipped (network error) — review manually."];
          }

          results[i] = { index: p.index, category: p.category, image_url: gen.image_url, status: "done", verdict, issues };
        } catch (e) {
          results[i] = { index: p.index, category: p.category, image_url: "", status: "failed", error: e instanceof Error ? e.message : String(e) };
        }
        setGenImages([...results]);
        // Persist THIS image immediately — a closed tab or crash mid-batch
        // loses nothing, and the loop resumes from the next missing image. The
        // server upsert is atomic, so concurrent persists don't clobber.
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "stage3_image_upsert", image: results[i] }),
        }).catch((e) => console.error(`persist image #${p.index} failed:`, e));
      };

      // Work queue of indices still needing a generation (resume skips the ones
      // already done). A pool of CONCURRENCY workers drains it, so up to 3
      // images generate at once. "Stop after current" lets in-flight images
      // finish but starts no new ones — workers exit when stopRef flips.
      const CONCURRENCY = 3;
      const queue = saved.map((_, i) => i).filter((i) => results[i]?.status !== "done");
      const worker = async () => {
        for (;;) {
          if (stopRef.current) break;
          const i = queue.shift();
          if (i === undefined) break;
          await processOne(i);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
      const allSettled = results.every((r) => r !== null);
      if (allSettled) {
        // Authoritative write: persist the full images array alongside the
        // status flip, so a completed run always has all 8 even if an individual
        // per-image save was lost to a concurrent-write race mid-generation.
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed", stage3_remaining_images: JSON.stringify(results) }),
        }).catch((e) => { console.error("complete status failed:", e); setErr("Images generated, but marking the run complete failed — hit Refresh."); });
      }
      setBusy(null);
      await fetchRun();
    };

    // Mid-generation view
    if (busy === "generate-8") {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Generating the 8 images…</h3>
            <button
              onClick={() => { stopRef.current = true; }}
              className="cursor-pointer inline-flex items-center gap-[6px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-red)]/50 bg-[var(--color-red-bg)] text-[var(--color-red)] transition-all hover:brightness-95"
            >
              ■ Stop after current
            </button>
          </div>
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">
            {genImages.filter(Boolean).length} of {genImages.length} done · up to 3 at a time · {heroUrl ? "all referencing the approved hero" : "all referencing your source product photos"}
          </p>
          <GenGrid heroUrl={heroUrl} images={genImages} />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Review the 8 prompts</h3>
          <p className="text-[12px] text-[var(--color-text-3)]">What each image will show.</p>
        </div>
        <ValidationBadge raw={run.stage3_remaining_validation} />
        {err && <ErrBox msg={err} />}
        <div className="space-y-3">
          {saved.map((p, i) => {
            const objective = promptSection(p.prompt, "OBJECTIVE");
            const scene = promptSection(p.prompt, "SCENE INSTRUCTIONS");
            const benefit = promptSection(p.prompt, "BENEFIT TO COMMUNICATE");
            const summary = objective || p.prompt.replace(/\s+/g, " ").slice(0, 220);
            const editing = editingPromptIdxs.has(i);
            return (
              <div key={i} className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-[600] text-[var(--color-text)]">#{p.index} {p.image_type || p.category}</span>
                  <span className="font-[var(--font-ibm-plex-mono)] text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] border border-[var(--color-border)] px-2 py-0.5 rounded">{p.aspect_ratio}</span>
                  <button
                    onClick={() => { setAiCardIdx(aiCardIdx === i ? null : i); setAiCardText(""); setAiCardErr(null); }}
                    className="ml-auto cursor-pointer text-[10.5px] font-[620] text-[var(--color-accent-text)] hover:underline"
                  >
                    {aiCardIdx === i ? "Cancel AI edit" : "✦ Edit with AI"}
                  </button>
                  <button
                    onClick={() => { if (!editing) pushHistory(p, "edited"); setEditingPromptIdxs((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; }); }}
                    className="cursor-pointer text-[10.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline"
                  >
                    {editing ? "Hide full prompt" : "Edit full prompt"}
                  </button>
                </div>
                {aiCardIdx === i && (
                  <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-2.5 space-y-2">
                    <textarea
                      value={aiCardText}
                      onChange={(e) => setAiCardText(e.target.value)}
                      placeholder="Change the premise — e.g. “set this in a bathroom instead of the kitchen”, “no people, product only”, “make it winter”"
                      rows={2}
                      autoFocus
                      disabled={aiCardBusy}
                      className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-2.5 py-1.5 text-[12px] resize-y placeholder:text-[var(--color-text-4)] focus:outline-none focus:border-[var(--color-accent)]"
                    />
                    {aiCardErr && <p className="text-[11px] text-[var(--color-red)]">{aiCardErr}</p>}
                    <button
                      onClick={() => aiRewriteCard(i)}
                      disabled={aiCardBusy || aiCardText.trim().length < 5}
                      className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {aiCardBusy ? "Rewriting…" : "Rewrite prompt"}
                    </button>
                  </div>
                )}
                <div className="flex gap-3 flex-wrap">
                  <div className="w-[220px] shrink-0">
                    <PromptPreview p={p} heroUrl={heroUrl} />
                  </div>
                  <div className="flex-1 min-w-[220px] space-y-1.5">
                    <p className="text-[12.5px] leading-relaxed text-[var(--color-text)]">{summary}</p>
                    {scene && <p className="text-[11.5px] leading-snug text-[var(--color-text-3)]"><span className="font-[620] text-[var(--color-text-2)]">Scene:</span> {scene}</p>}
                    {benefit && <p className="text-[11.5px] leading-snug text-[var(--color-text-3)]"><span className="font-[620] text-[var(--color-text-2)]">Communicates:</span> {benefit}</p>}
                    {p.overlay_text && (
                      <p className="text-[11.5px] text-[var(--color-text-2)]">
                        <span className="font-[620]">Text on image:</span>{" "}
                        <span className="font-[var(--font-ibm-plex-mono)] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5">{p.overlay_text}</span>
                      </p>
                    )}
                  </div>
                </div>
                {editing && (
                  <textarea
                    value={p.prompt}
                    onChange={(e) => setDraft(i, e.target.value)}
                    rows={10}
                    className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
                  />
                )}
                <div className="pt-0.5 space-y-1">
                  <p className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-widest text-[var(--color-text-4)]">Reference images for this shot</p>
                  <RefPicker candidates={candidatesFor(p)} selected={refsFor(p, effRefOverrides, heroUrl)} onToggle={(u) => toggleRefOverride(p, u)} collapsible />
                </div>

                {/* previous versions of this prompt, and images already made for this slot */}
                {(versionsFor(p).length > 0 || doneByIndex.get(p.index)) && (
                  <div className="pt-1 space-y-1.5">
                    <div className="flex items-center gap-3.5">
                      {versionsFor(p).length > 0 && (
                        <button onClick={() => setHistoryIdx(historyIdx === i ? null : i)}
                          className="cursor-pointer text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr">
                          {historyIdx === i ? "Hide previous versions" : `Previous versions (${versionsFor(p).length})`}
                        </button>
                      )}
                      {doneByIndex.get(p.index) && (
                        <span className="text-[11px] text-[var(--color-text-3)]">
                          An image already exists for this slot — generating replaces it.
                        </span>
                      )}
                    </div>
                    {historyIdx === i && (
                      <div className="space-y-1.5">
                        {versionsFor(p).map((v, k) => (
                          <div key={k} className="flex items-start gap-2.5 rounded-[7px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2">
                            <span className="ff-mono text-[9.5px] uppercase tracking-wider text-[var(--color-text-3)] shrink-0 pt-0.5">
                              {v.source === "written" ? "written" : v.source === "ai" ? "ai" : "edited"}
                            </span>
                            <p className="flex-1 min-w-0 text-[11.5px] leading-snug text-[var(--color-text-2)] line-clamp-3">{v.prompt}</p>
                            <button onClick={() => restoreVersion(i, v)}
                              className="cursor-pointer text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text)] shrink-0 tr">Use this</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {doneByIndex.size > 0 && (
          <p className="text-[12px] text-[var(--color-amber)]">
            {doneByIndex.size} of {saved.length} images were already generated in an interrupted pass — generation resumes from the rest.
          </p>
        )}
        <div className="flex gap-3 flex-wrap items-center">
          <button disabled={busy !== null} onClick={generateAll} className={btnPrimary}>
            {doneByIndex.size > 0 ? `Resume generation (${doneByIndex.size}/${saved.length} done) →` : "Generate 8 Images →"}
          </button>
          {/* Step back to the hero QC gate (only meaningful when a hero exists —
              skip-hero runs generated straight from source photos). */}
          {heroUrl && (
            <button disabled={busy !== null} onClick={() => trigger("/api/stage3/back-to-hero", { runId }, "back-hero")} className={btnSecondary}>
              {busy === "back-hero" ? "Going back…" : "← Back to hero"}
            </button>
          )}
          {/* Recover images that already generated on Higgsfield but never
              persisted (the pre-fix persistence bug) — no re-generation. */}
          <button disabled={busy !== null} onClick={() => trigger("/api/stage3/recover-from-higgsfield", { runId }, "recover-hf")} className={btnSecondary}>
            {busy === "recover-hf" ? "Recovering…" : "Recover from Higgsfield"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-3)]">&ldquo;Recover from Higgsfield&rdquo; pulls images already generated in your Higgsfield history.</p>
      </div>
    );
  }

  /* ── COMPLETED ───────────────────────────────────────────────────────── */
  if (status === "completed") {
    let imgs = safeParse<RemImage[]>(run.stage3_remaining_images, []);
    // Old-path fallback: render whatever's in generated_images so finished
    // pre-redesign runs still display their images here.
    if (imgs.length === 0 && hasOldImages) {
      const old = safeParse<Array<{ image_url?: string; category?: string; status?: string }>>(run.generated_images, []);
      imgs = old
        .filter((g) => g?.image_url && g.status !== "failed")
        .map((g, i) => ({ index: i + 1, category: g.category || "", image_url: g.image_url as string, status: "done" as const }));
    }
    const prompts = safeParse<RemainingPrompt[]>(
      run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts,
      [],
    );
    const placement = safeParse<Placement | null>(run.stage3_placement, null);
    const referenceImages = safeParse<string[]>(run.stage3_reference_images, []);
    return (
      <div className="space-y-4">
        <SendToDrive runId={runId} />
        <ShopifyFill runId={runId} initialUrl={run.shopify_product_url} initialAdminUrl={(() => { try { return run.shopify_push_state ? (JSON.parse(run.shopify_push_state) as { adminUrl?: string }).adminUrl ?? null : null; } catch { return null; } })()} />
        <details>
          <summary className="cursor-pointer text-[11px] text-[var(--color-text-4)]">Create a brand-new draft product instead (old flow)</summary>
          <div className="pt-2"><ShopifyPush runId={runId} /></div>
        </details>
        <CompletedReview
          runId={runId}
          heroUrl={heroUrl}
          initialImages={imgs}
          initialPrompts={prompts}
          initialPlacement={placement}
          initialReferenceImages={referenceImages}
          refCandidates={refCandidates}
          initialRefOverrides={effRefOverrides}
          productDescription={run.product_description ?? run.product_name ?? ""}
        />
      </div>
    );
  }

  // Old-flow runs (generated via the previous /stage3 page) store their images
  // in generated_images and sit at status 'awaiting_user' — none of the hero
  // branches match, so render those images read-only here instead of a dead
  // "status / Refresh" fallback.
  if (hasOldImages) {
    const old = safeParse<Array<{ image_url?: string; category?: string; status?: string }>>(run.generated_images, []);
    const imgs: RemImage[] = old
      .filter((g) => g?.image_url && g.status !== "failed")
      .map((g, i) => ({ index: i + 1, category: g.category || "", image_url: g.image_url as string, status: "done" as const }));
    return (
      <div className="space-y-3">
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Stage 4 images ({imgs.length})</h3>
        <p className="text-[11px] text-[var(--color-text-3)]">Generated on the previous Stage 4 flow.</p>
        <GenGrid heroUrl={null} images={imgs} />
      </div>
    );
  }

  // Dead-end recovery: states that should have data but don't (the generating
  // route died before writing it). Offer the restart instead of a blank wall.
  if ((status === "awaiting_hero_qc" && !heroUrl) || (status === "awaiting_qc" && !run.stage3_remaining_prompts)) {
    const what = status === "awaiting_hero_qc" ? "The hero image failed to save" : "The 8 prompts failed to generate";
    const restart = async () => {
      setBusy("recover");
      try {
        await fetch(`/api/runs/${runId}/restart-stage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "stage3-prompts" }),
        });
      } finally { setBusy(null); await fetchRun(); }
    };
    return (
      <div className="space-y-3">
        <ErrBox msg={`${what} — the generation step was interrupted. Restart Stage 4 to try again from the start.`} />
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy !== null} onClick={restart} className={btnPrimary}>
            {busy === "recover" ? "Restarting…" : "Restart Stage 4"}
          </button>
          <button disabled={busy !== null} onClick={fetchRun} className={btnSecondary}>Refresh</button>
        </div>
      </div>
    );
  }

  // Fallback (e.g. failed during hero flow): show whatever we have.
  return (
    <div className="space-y-3">
      {err && <ErrBox msg={err} />}
      {heroUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroUrl} alt="Hero" className="rounded-lg max-w-xs border border-[var(--color-border)]" />
        </>
      )}
      <p className="text-[12px] text-[var(--color-text-3)]">Stage 4 status: {status || "unknown"}.</p>
      <button disabled={busy !== null} onClick={fetchRun} className={btnSecondary}>Refresh</button>
    </div>
  );
}

/* ── Prompt summaries for the picture-first review ─────────────────────── */

// The gold-standard prompts are structured with ALL-CAPS section headers.
// Pull one section's text so the review can show WHAT the image will be
// without dumping the whole prompt.
function promptSection(prompt: string, header: string): string {
  const lines = prompt.split("\n");
  const isHeader = (l: string) => /^[A-Z][A-Z /&_-]{2,}:\s*$/.test(l.trim()) || /^[A-Z][A-Z /&_-]{2,}:\s+\S/.test(l.trim());
  const start = lines.findIndex((l) => l.trim().toUpperCase().startsWith(header.toUpperCase() + ":"));
  if (start === -1) return "";
  const first = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  const out: string[] = first ? [first] : [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// Storyboard mock of what the image will look like. Not a render — a frame in
// the image's real aspect ratio: split shots (comparison / before-after /
// problem-solution) show problem-left vs fixed-right with the product in the
// right half; everything else shows the product (hero) with the overlay text
// placed on the frame the way it will appear on the image.
function PromptPreview({ p, heroUrl }: { p: RemainingPrompt; heroUrl: string | null }) {
  const split = ["comparison", "before_after", "problem_solution"].includes(p.category);
  const ratio = (p.aspect_ratio || "1:1").replace(":", " / ");
  const overlayParts = (p.overlay_text || "").split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  const frameCls = "relative w-full overflow-hidden rounded-[9px] border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]";

  if (split) {
    return (
      <div className={frameCls} style={{ aspectRatio: ratio }}>
        <div className="absolute inset-0 flex">
          {/* problem half */}
          <div className="w-1/2 h-full bg-[var(--color-surface-2)] flex flex-col items-center justify-center gap-1.5 p-2 text-center">
            <span className="font-[var(--font-ibm-plex-mono)] text-[8px] uppercase tracking-widest text-[var(--color-text-4)]">Problem</span>
            <span className="text-[10px] leading-snug font-[640] text-[var(--color-text-2)]">{overlayParts[0] || "the messy before"}</span>
          </div>
          {/* fixed-with-product half */}
          <div className="w-1/2 h-full bg-[var(--color-accent-weak)] flex flex-col items-center justify-center gap-1.5 p-2 text-center border-l border-dashed border-[var(--color-border-strong)]">
            <span className="font-[var(--font-ibm-plex-mono)] text-[8px] uppercase tracking-widest text-[var(--color-accent-text)]">With product</span>
            {heroUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={heroUrl} alt="" className="w-[60%] max-h-[60%] object-contain rounded" />
            )}
            <span className="text-[10px] leading-snug font-[640] text-[var(--color-text)]">{overlayParts[1] || overlayParts[0] || "fixed by the product"}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={frameCls} style={{ aspectRatio: ratio }}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2">
        {heroUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={heroUrl} alt="" className="w-[72%] max-h-[72%] object-contain rounded" />
        )}
        <span className="font-[var(--font-ibm-plex-mono)] text-[8px] uppercase tracking-widest text-[var(--color-text-4)]">{(p.image_type || p.category || "").toString()}</span>
      </div>
      {p.overlay_text && (
        <div className="absolute inset-x-0 top-0 p-2 text-center">
          <span className="inline-block text-[10px] leading-snug font-[700] text-[var(--color-text)] bg-[var(--color-surface)]/85 rounded px-1.5 py-0.5 max-w-full">
            {p.overlay_text}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Per-image reference selection ─────────────────────────────────────── */

type RefCandidate = { url: string; label: string };

// The references image generation actually uses for one of the 8 prompts:
// the operator's per-index override when set, else the prompt's curated
// source_image_references, else the approved hero.
function refsFor(p: RemainingPrompt, overrides: Record<string, string[]>, heroUrl: string | null): string[] {
  const o = overrides[String(p.index)];
  if (o && o.length) return o;
  return p.source_image_references?.length ? p.source_image_references : (heroUrl ? [heroUrl] : []);
}

// Compact multi-select of candidate reference images. Selected = full color +
// accent border; unselected = dimmed. Min-1 is enforced by the callers.
function RefPicker({ candidates, selected, onToggle, disabled, collapsible }: {
  candidates: RefCandidate[];
  selected: string[];
  onToggle: (url: string) => void;
  disabled?: boolean;
  /** Long pools (every photo on the run) start folded to the chosen ones. */
  collapsible?: boolean;
}) {
  if (!candidates.length) return null;
  // Every candidate is always visible — the operator picks by looking, so
  // nothing is hidden behind a toggle. `collapsible` is kept for the prop
  // signature only.
  void collapsible;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {candidates.map((c) => {
        const on = selected.includes(c.url);
        return (
          <button
            key={c.url}
            type="button"
            onClick={() => onToggle(c.url)}
            disabled={disabled}
            title={`${c.label} — ${on ? "referenced; click to remove" : "not referenced; click to add"}`}
            className={`relative w-[96px] h-[96px] rounded-[7px] overflow-hidden border-2 cursor-pointer tr bg-[var(--color-bg)] ${on ? "border-[var(--color-accent)]" : "border-[var(--color-border)] opacity-50 hover:opacity-90"}`}
          >
            {/* whole photo, never cropped — the operator is choosing by what's IN it */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.url} alt="" className="w-full h-full object-contain" />
            <span className="absolute inset-x-0 bottom-0 bg-black/65 text-white text-[7px] font-[700] text-center py-[1px] tracking-wider">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Completed review: per-image verdict override, fail reason, regenerate ── */
function CompletedReview({
  runId,
  heroUrl,
  initialImages,
  initialPrompts,
  initialPlacement,
  initialReferenceImages,
  refCandidates,
  initialRefOverrides,
  productDescription,
}: {
  runId: number;
  heroUrl: string | null;
  initialImages: RemImage[];
  initialPrompts: RemainingPrompt[];
  initialPlacement: Placement | null;
  initialReferenceImages: string[];
  refCandidates: RefCandidate[];
  /** What the product actually is — the auditor checks the image against it. */
  productDescription: string;
  initialRefOverrides: Record<string, string[]>;
}) {
  const [images, setImages] = useState<RemImage[]>(initialImages);
  // Per-image reference overrides — updated when the operator changes the
  // selection in the regenerate modal, persisted so later passes reuse it.
  const [refOverrides, setRefOverrides] = useState<Record<string, string[]>>(initialRefOverrides);
  const saveRefOverride = (index: number, refs: string[]) => {
    // Functional update: bulk fix persists several overrides concurrently, and
    // merging from a stale closure would drop sibling writes.
    setRefOverrides((prev) => {
      const merged = { ...prev, [String(index)]: refs };
      fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_ref_overrides: JSON.stringify(merged) }),
      }).catch(() => {});
      return merged;
    });
  };
  const candidatesFor = (pp: RemainingPrompt): RefCandidate[] => {
    const cur = refsFor(pp, refOverrides, heroUrl);
    const extra = cur.filter((u) => !refCandidates.some((c) => c.url === u)).map((u) => ({ url: u, label: "REF" }));
    return [...refCandidates, ...extra];
  };
  // Prompts are stateful: a regenerate with an edited prompt saves it back, so
  // the NEXT rewrite starts from the prompt that was last actually used rather
  // than reverting to the original.
  const [prompts, setPrompts] = useState<RemainingPrompt[]>(initialPrompts);
  const [regenIdx, setRegenIdx] = useState<number | null>(null); // index into images
  // Set of image indices currently (re)generating. A Set rather than a single
  // index because bulk-fix runs several regenerations at once — each tile needs
  // its own spinner, and one finishing must not clear the others'.
  const [busyIdxs, setBusyIdxs] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(initialPlacement);
  const [placing, setPlacing] = useState(false);
  const [placeErr, setPlaceErr] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);
  const [relinkErr, setRelinkErr] = useState<string | null>(null);
  const [lb, setLb] = useState<number | null>(null);

  // Re-link images that finished on Higgsfield but read "failed" here (e.g. the
  // 180s polling timeout hit while Higgsfield kept rendering). Pulls from the
  // account's history by prompt match — no re-generation, no extra cost.
  const relinkFromHiggsfield = async () => {
    setRelinking(true);
    setRelinkErr(null);
    try {
      const res = await fetch("/api/stage3/recover-from-higgsfield", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (!data.success) { setRelinkErr(data.error || `Relink failed (${res.status})`); return; }
      window.location.reload();
    } catch (e) {
      setRelinkErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setRelinking(false);
    }
  };

  const promptFor = useCallback(
    (im: RemImage) => prompts.find((p) => p.index === im.index) ?? null,
    [prompts],
  );

  // Ask the AI to look at the images and assign one to each of the 3 body
  // sections; the rest become top-of-page product shots. Persists server-side.
  const runPlacement = useCallback(async () => {
    setPlacing(true); setPlaceErr(null);
    try {
      const res = await fetch("/api/stage3/placement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (!data.success) { setPlaceErr(data.error || "Placement failed"); return; }
      setPlacement(data.placement as Placement);
    } catch (e) {
      setPlaceErr(e instanceof Error ? e.message : "Network error");
    } finally { setPlacing(false); }
  }, [runId]);

  // Auto-run placement once when a completed run has enough images but no
  // saved placement yet (covers runs finished before this feature existed).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    const usable = images.filter((im) => im.image_url && im.status !== "failed");
    if (!placement && usable.length >= 2) { autoTried.current = true; runPlacement(); }
  }, [placement, images, runPlacement]);

  // Persist ONE image via the server-side upsert (read-modify-write on the
  // server). Each image saves independently, so a stale full-array snapshot —
  // from a second tab or an in-flight regeneration — can never clobber other
  // images. Serialized through a chain so saves commit in call order; failures
  // surface instead of vanishing.
  const [persistErr, setPersistErr] = useState<string | null>(null);
  const persistChain = useRef<Promise<unknown>>(Promise.resolve());
  const persistImage = useCallback((image: RemImage) => {
    persistChain.current = persistChain.current
      .catch(() => {})
      .then(() =>
        fetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "stage3_image_upsert", image }),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          setPersistErr(null);
        }),
      )
      .catch((e) => {
        console.error(`persist image #${image.index} failed:`, e);
        setPersistErr(`Saving image #${image.index} failed — your last change may not stick. Check your connection and retry.`);
      });
    return persistChain.current;
  }, [runId]);

  // Persist an edited prompt for one image back onto the run, so reopening the
  // regenerate modal (or a later AI rewrite) builds on the prompt that was last
  // used rather than the original. Mirrors the prompt-review gate's write to
  // stage3_remaining_prompts_edited. Best-effort: a failed save never blocks
  // the generation the operator just asked for.
  const savePromptText = useCallback((promptIndex: number, text: string) => {
    setPrompts((prev) => {
      const next = prev.map((p) => (p.index === promptIndex ? { ...p, prompt: text } : p));
      persistChain.current = persistChain.current
        .catch(() => {})
        .then(() =>
          fetch(`/api/runs/${runId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage3_remaining_prompts_edited: JSON.stringify(next) }),
          }),
        )
        .catch((e) => console.error(`persist prompt #${promptIndex} failed:`, e));
      return next;
    });
  }, [runId]);

  // Audit one image against the prompt that is on screen for it. Used after a
  // regeneration, after restoring an older version, after a relink, and from
  // the tile's own "Re-audit" — so a verdict always describes the image the
  // operator is actually looking at.
  const [auditIdxs, setAuditIdxs] = useState<Set<number>>(new Set());
  const overlayFor = (imageIndex: number) => prompts.find((p) => p.index === imageIndex)?.overlay_text || null;
  const refsForIndex = (imageIndex: number) => {
    const p = prompts.find((x) => x.index === imageIndex);
    return p ? refsFor(p, refOverrides, heroUrl) : (heroUrl ? [heroUrl] : []);
  };
  const auditImage = useCallback(async (i: number, imageUrl: string, promptText: string, category: string, imageIndex: number) => {
    setAuditIdxs((prev) => new Set(prev).add(i));
    try {
      const audit = await fetch("/api/stage3/audit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, category, prompt_used: promptText, product_description: productDescription, overlay_text_used: overlayFor(imageIndex), reference_urls: refsForIndex(imageIndex), run_id: runId }),
      }).then((r) => r.json());
      setImages((prev) => prev.map((x, j) => {
        if (j !== i) return x;
        const updated: RemImage = audit.success
          ? { ...x, verdict: audit.result?.verdict === "pass" ? "pass" : "fail", issues: audit.result?.issues ?? [], user_override: null }
          : { ...x, verdict: undefined, issues: ["Audit unavailable — review manually."], user_override: null };
        persistImage(updated);
        return updated;
      }));
    } catch {
      setImages((prev) => prev.map((x, j) => (j === i ? { ...x, issues: ["Audit failed — review manually."] } : x)));
    } finally {
      setAuditIdxs((prev) => { const n = new Set(prev); n.delete(i); return n; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, productDescription]);

  // Bring back a previous version of an image. The current image moves into
  // history (nothing is ever lost), the restored one becomes current, and its
  // prompt becomes the "last used" prompt so an edit builds on what actually
  // produced the image on screen.
  const restoreVersion = (i: number, entry: { image_url: string; prompt?: string }) => {
    setRegenIdx(null);
    setImages((prev) => {
      const cur = prev[i];
      const curPrompt = prompts.find((p) => p.index === cur.index)?.prompt;
      const history = [
        ...(cur.image_url ? [{ image_url: cur.image_url, prompt: curPrompt }] : []),
        ...(cur.history ?? []).filter((h) => h.image_url !== entry.image_url),
      ].slice(0, 5);
      // The restored image is a different picture, so the old verdict cannot
      // stand: clear it and re-audit against the prompt that produced it.
      const updated: RemImage = { index: cur.index, category: cur.category, image_url: entry.image_url, status: "done", history };
      persistImage(updated);
      void auditImage(i, entry.image_url, entry.prompt ?? curPrompt ?? "", cur.category, cur.index);
      return prev.map((x, j) => (j === i ? updated : x));
    });
    if (entry.prompt?.trim()) {
      const im = images[i];
      if (im) savePromptText(im.index, entry.prompt);
    }
  };

  // Toggle the operator override pass ↔ fail ↔ (clear).
  const toggleVerdict = (i: number) => {
    setImages((prev) => {
      const im = prev[i];
      const cur = im.user_override ?? null;
      const auto = im.verdict ?? "pass";
      // null → opposite of auto ; then flip ; flipping back to auto clears.
      let nextOverride: "pass" | "fail" | null;
      if (cur === null) nextOverride = auto === "pass" ? "fail" : "pass";
      else { const flip = cur === "pass" ? "fail" : "pass"; nextOverride = flip === auto ? null : flip; }
      const next = prev.map((x, j) => (j === i ? { ...x, user_override: nextOverride } : x));
      persistImage(next[i]);
      return next;
    });
  };

  // Regenerate a single image with an (optionally AI-rewritten) prompt.
  const regenerate = async (i: number, newPromptText: string, productDesc: string, refsExplicit?: string[]) => {
    const im = images[i];
    const p = promptFor(im);
    if (!p) return;
    // Close the modal right away and flip the tile into a generating state so
    // the operator gets immediate feedback while the (slow) gen+audit runs.
    setRegenIdx(null);
    setBusyIdxs((s) => new Set(s).add(i));
    // Save the prompt actually used, so the next rewrite/regeneration starts
    // from it instead of reverting to the original generated prompt.
    if (newPromptText.trim() && newPromptText !== p.prompt) {
      savePromptText(p.index, newPromptText);
    }
    try {
      // Operator-picked refs from the modal win; else the stored per-image
      // override; else the prompt's curated defaults.
      const refs = refsExplicit?.length ? refsExplicit : refsFor(p, refOverrides, heroUrl);
      if (refsExplicit?.length) saveRefOverride(p.index, refsExplicit);
      const gen = await fetch("/api/stage3/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: newPromptText, model: p.model, reference_images: refs, aspect_ratio: p.aspect_ratio }),
      }).then((r) => r.json());
      if (!gen.success) throw new Error(gen.error || "generation failed");

      let verdict: "pass" | "fail" = "pass";
      let issues: string[] = [];
      try {
        const audit = await fetch("/api/stage3/audit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: gen.image_url, category: p.category, prompt_used: newPromptText, product_description: productDesc, overlay_text_used: p.overlay_text || null, reference_urls: refs, run_id: runId }),
        }).then((r) => r.json());
        if (audit.success) { verdict = audit.result?.verdict === "pass" ? "pass" : "fail"; issues = audit.result?.issues ?? []; }
        else { console.error("audit failed:", audit.error); issues = ["Audit skipped (auditor unavailable) — review manually."]; }
      } catch (e) {
        console.error("audit call failed:", e);
        issues = ["Audit skipped (network error) — review manually."];
      }

      // Functional update + per-image persist, so a concurrent regeneration of
      // another tile can't overwrite this one with a stale snapshot.
      setImages((prev) => {
        const cur = prev[i];
        // Keep the replaced image (and the prompt that produced it) so the
        // operator can go back to it. Newest first, capped at 5 versions.
        const history = [
          ...(cur.image_url ? [{ image_url: cur.image_url, prompt: p.prompt }] : []),
          ...(cur.history ?? []),
        ].slice(0, 5);
        const updated: RemImage = { index: cur.index, category: cur.category, image_url: gen.image_url, status: "done", verdict, issues, user_override: null, history };
        persistImage(updated);
        return prev.map((x, j) => (j === i ? updated : x));
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImages((prev) => {
        const next = prev.map((x, j) => (j === i ? { ...x, status: "failed" as const, error: msg } : x));
        persistImage(next[i]);
        return next;
      });
    } finally {
      setBusyIdxs((s) => { const n = new Set(s); n.delete(i); return n; });
    }
  };

  // Regenerate every failed/flagged image in one go, each with its (possibly
  // bulk-edited) prompt. Runs 3 at a time via a small worker pool — each call
  // reuses the single-image regenerate path (functional state merge + serialized
  // persist), and the server upsert is atomic, so concurrency is safe.
  const regenerateAllFailed = async (drafts: Record<number, string>, refsByIdx?: Record<number, string[]>) => {
    setBulkOpen(false);
    setBulkRunning(true);
    try {
      const targets = images
        .map((im, i) => ({ im, i }))
        .filter(({ im }) => im.status === "failed" || effVerdict(im) === "fail")
        .map(({ im, i }) => ({ i, text: drafts[i] ?? promptFor(im)?.prompt ?? "" }))
        .filter((t) => t.text);
      const CONCURRENCY = 3;
      const queue = [...targets];
      const worker = async () => {
        for (;;) {
          const t = queue.shift();
          if (!t) break;
          await regenerate(t.i, t.text, productDescription, refsByIdx?.[t.i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
    } finally {
      setBulkRunning(false);
    }
  };

  // Download every image — the hero AND all generated derivatives — each as its
  // own file (not a zip). Tracks fetch failures so a partial result is reported.
  const [zipping, setZipping] = useState(false);
  const [zipNote, setZipNote] = useState<string | null>(null);
  const downloadAll = async () => {
    if (zipping) return;
    setZipping(true);
    setZipNote(null);
    try {
      const targets: Array<{ url: string; name: string }> = [];
      if (heroUrl) targets.push({ url: heroUrl, name: "01_hero.png" });
      for (const im of images) {
        if (im.image_url && im.status !== "failed") {
          targets.push({ url: im.image_url, name: `${String(im.index).padStart(2, "0")}_${im.category || "image"}.png` });
        }
      }
      let ok = 0;
      // One file per image. Sequential with a small gap so the browser doesn't
      // drop the rapid-fire downloads (it asks once to allow multiple files).
      for (const t of targets) {
        try {
          const blob = await fetch(t.url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); });
          const href = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement("a"), { href, download: t.name });
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(href);
          ok++;
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) { console.error(`download failed for ${t.name}:`, e); }
      }
      if (ok === 0) { setZipNote("Couldn't fetch any images — check your connection."); return; }
      setZipNote(ok < targets.length ? `Downloaded ${ok} of ${targets.length} images — ${targets.length - ok} couldn't be fetched.` : null);
    } finally {
      setZipping(false);
    }
  };

  const passed = images.filter((im) => effVerdict(im) === "pass").length;
  const failed = images.filter((im) => effVerdict(im) === "fail").length;
  // Images that need fixing: a hard generation failure (Higgsfield rejected /
  // errored — often a content-guideline block) or an auditor "fail".
  const fixable = images
    .map((im, i) => ({ im, i }))
    .filter(({ im }) => im.status === "failed" || effVerdict(im) === "fail");

  // Placement: the AI looked at the images and chose one to anchor each of the
  // 3 body sections; everything else is a top-of-page product shot. We map the
  // chosen image `index` values to array positions for rendering. Until a
  // placement exists, everything shows as product shots (the auto-run fills it
  // in). This is a labeling-only split — generation is unchanged.
  const entries = images.map((im, i) => ({ im, i }));
  const sectionPicks: Array<{ section: number; index: number }> = placement
    ? [
        // Section 1 is the operator's manual GIF — only legacy placements carry it.
        ...(typeof placement.section_1 === "number" ? [{ section: 1, index: placement.section_1 }] : []),
        { section: 2, index: placement.section_2 },
        { section: 3, index: placement.section_3 },
      ]
    : [];
  const pickedIndexes = new Set(sectionPicks.map((s) => s.index));
  const sectionEntries = sectionPicks
    .map((s) => ({ ...s, entry: entries.find((e) => e.im.index === s.index) }))
    .filter((s): s is { section: number; index: number; entry: { im: RemImage; i: number } } => !!s.entry);
  const productEntries = entries.filter((e) => !pickedIndexes.has(e.im.index));

  // Fullscreen viewing — every visible image, hero first, in display order.
  const lbItems = [
    ...(heroUrl ? [{ url: heroUrl, label: "Hero" }] : []),
    ...images.filter((im) => im.image_url).map((im) => ({ url: im.image_url, label: `#${im.index} ${im.category}` })),
  ];
  const openLb = (url: string) => { const i = lbItems.findIndex((x) => x.url === url); if (i >= 0) setLb(i); };

  // Render one interactive image tile (verdict badge, regenerate, fail banner,
  // generating overlay). Index `i` is the position in the `images` array so
  // toggleVerdict/regenerate stay correct after regrouping.
  const renderTile = (im: RemImage, i: number) => {
    const v = effVerdict(im);
    const failReason = im.status === "failed" ? (im.error || "generation failed") : (im.issues?.filter(Boolean)[0] || "");
    const overridden = im.user_override != null;
    const regenerating = busyIdxs.has(i);
    const auditing = auditIdxs.has(i);
    const promptText = prompts.find((p) => p.index === im.index)?.prompt ?? "";
    return (
      <div className={`aspect-square rounded-[11px] border overflow-hidden relative group ${v === "fail" || im.status === "failed" ? "border-[var(--color-red)]/60" : "border-[var(--color-border)]"} bg-[var(--color-surface)]`}>
        {(regenerating || auditing) && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/65 backdrop-blur-[2px]">
            <div className="w-4 h-4 rounded-full bg-white animate-pulse" />
            <span className="text-[10px] text-white font-[var(--font-ibm-plex-mono)] uppercase tracking-wide">{regenerating ? "Generating…" : "Auditing…"}</span>
          </div>
        )}
        {im.image_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.image_url} alt={im.category} loading="lazy" decoding="async" onClick={() => openLb(im.image_url)} className={`w-full h-full object-cover cursor-zoom-in ${v === "fail" ? "opacity-80" : ""}`} />
            {!v && !auditing && (
              <button onClick={() => auditImage(i, im.image_url, promptText, im.category, im.index)}
                title="This image has not been audited"
                className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide px-2 py-0.5 rounded-full cursor-pointer bg-[var(--color-surface-3)] text-[var(--color-text-2)]">
                not audited
              </button>
            )}
            {v && (
              <button
                onClick={() => toggleVerdict(i)}
                title={overridden ? `Overridden — auditor said ${im.verdict}. Click to cycle.` : `Auditor: ${im.verdict}. Click to override.`}
                className={`absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide px-2 py-0.5 rounded-full text-white cursor-pointer ${v === "pass" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]"} ${overridden ? "ring-1 ring-white/60" : ""}`}
              >
                {v}{overridden ? "•" : ""}
              </button>
            )}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-2 flex items-center justify-end gap-1 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openLb(im.image_url)} title="View fullscreen" className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer">⤢</button>
              <button onClick={() => auditImage(i, im.image_url, promptText, im.category, im.index)} disabled={auditing} title="Run the audit again on this image" className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer disabled:opacity-50">Re-audit</button>
              <button onClick={() => setRegenIdx(i)} className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer">Regenerate</button>
              <button onClick={() => dlImg(im.image_url, `${String(im.index).padStart(2, "0")}_${im.category}.png`)} className="px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-[var(--font-ibm-plex-mono)] rounded cursor-pointer">↓</button>
            </div>
            {v === "fail" && failReason && (
              <button onClick={() => setRegenIdx(i)} title="Click to regenerate this image" className="absolute bottom-0 left-0 right-0 z-10 text-left px-2 py-1.5 bg-[var(--color-red)]/90 text-white cursor-pointer hover:bg-[var(--color-red)]">
                <span className="block text-[8.5px] font-[700] uppercase tracking-wide">Failed · tap to fix</span>
                <span className="block text-[9px] opacity-90 leading-snug line-clamp-2">{failReason}</span>
              </button>
            )}
          </>
        ) : (
          <button onClick={() => setRegenIdx(i)} className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1.5 cursor-pointer bg-[var(--color-red-bg)] text-center">
            <span className="text-[var(--color-red)] font-[700] text-[11px]">Failed</span>
            <span className="text-[var(--color-text-2)] text-[10px] line-clamp-3">{failReason}</span>
            <span className="mt-1 text-[9px] font-[700] uppercase tracking-wide text-[var(--color-red)]">Tap to regenerate</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">{heroUrl ? "Stage 4 complete · hero + 8" : "Stage 4 images"}</h3>
        <span className="text-[11px] text-[var(--color-green)]">{passed} pass</span>
        {failed > 0 && <span className="text-[11px] text-[var(--color-red)]">{failed} fail</span>}
        {fixable.length > 0 && (
          <button
            onClick={() => setBulkOpen(true)}
            disabled={bulkRunning || busyIdxs.size > 0}
            className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-3 py-[6px] text-[12px] font-[620] border border-[var(--color-red)]/50 bg-[var(--color-red-bg)] text-[var(--color-red)] transition-all hover:brightness-95 disabled:opacity-50 whitespace-nowrap"
          >
            {bulkRunning ? "Regenerating failed…" : `Fix all ${fixable.length} failed →`}
          </button>
        )}
        <button
          onClick={downloadAll}
          disabled={zipping}
          className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-3 py-[6px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap"
        >
          {zipping ? "Downloading…" : "↓ Download all"}
        </button>
        <button
          onClick={relinkFromHiggsfield}
          disabled={relinking || bulkRunning || busyIdxs.size > 0}
          title="Failed tiles that actually finished on Higgsfield (e.g. a timeout while it was still rendering) get their images re-linked from your Higgsfield history — no re-generation, no extra cost."
          className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-3 py-[6px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap"
        >
          {relinking ? "Relinking…" : "Relink from Higgsfield"}
        </button>
      </div>
      {relinkErr && <ErrBox msg={relinkErr} />}
      {lb !== null && <Lightbox items={lbItems} index={lb} onClose={() => setLb(null)} onIndex={setLb} />}
      <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
        <p className="text-[11px] text-[var(--color-text-3)] max-w-xl">Sections 2 and 3 get one image each; the rest go to the gallery. Section 1 is your GIF.</p>
        <button
          onClick={runPlacement}
          disabled={placing}
          className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-3 py-[7px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap"
        >
          {placing ? "Placing…" : placement ? "↺ Re-run auto-placement" : "Auto-place images"}
        </button>
      </div>
      {placeErr && <ErrBox msg={placeErr} />}
      {persistErr && <ErrBox msg={persistErr} />}
      {zipNote && <p className="text-[12px] text-[var(--color-amber)]">{zipNote}</p>}

      <div className="max-w-xl">
        <Stage3ReferenceImages runId={Number(runId)} initial={initialReferenceImages} />
      </div>

      {/* ── Product shots — top of the page ────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[var(--color-text-2)]">
          Top of page · product shots <span className="text-[var(--color-text-4)] font-[500] normal-case tracking-normal">— {productEntries.length + (heroUrl ? 1 : 0)} images</span>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {heroUrl && (
            <div className="flex flex-col gap-1.5">
              <div className="aspect-square rounded-[11px] border-2 border-[var(--color-green)] overflow-hidden relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroUrl} alt="Hero" loading="lazy" decoding="async" onClick={() => openLb(heroUrl)} className="w-full h-full object-cover cursor-zoom-in" />
                <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-white px-2 py-0.5 rounded-full">Hero</span>
                <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openLb(heroUrl)} title="View fullscreen" className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">⤢</button>
                  <button onClick={() => dlImg(heroUrl, "01_hero.png")} className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">↓</button>
                </div>
              </div>
              <div className="px-0.5">
                <p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-green)]">Hero shot</p>
                <p className="text-[10px] text-[var(--color-text-3)] leading-snug">Main product image</p>
              </div>
            </div>
          )}
          {productEntries.map(({ im, i }) => (
            <div key={i} className="flex flex-col gap-1.5">
              {renderTile(im, i)}
              <div className="px-0.5">
                <p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-text-2)]">{catLabel(im.category)}</p>
                <p className="text-[10px] text-[var(--color-text-3)] leading-snug">Product shot</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body sections — AI-placed, one image each ──────────────────── */}
      {placing && !placement ? (
        <Spinner label="Looking at the images and assigning sections…" />
      ) : sectionEntries.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[var(--color-text-2)]">
            Body sections · one image each <span className="text-[var(--color-text-4)] font-[500] normal-case tracking-normal">— problem → solution → proof</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {sectionEntries.map(({ section, entry }) => {
              const { im, i } = entry;
              const copy = (promptFor(im)?.overlay_text || "").trim();
              const reason = placement?.reasons?.[String(section)] || "";
              return (
                <div key={i} className="flex flex-col gap-1.5">
                  {renderTile(im, i)}
                  <div className="px-0.5">
                    <p className="text-[10px] font-[680] uppercase tracking-wide text-[var(--color-accent-text)]">Section {section} · {catLabel(im.category)}</p>
                    {copy
                      ? <p className="text-[10px] text-[var(--color-text-3)] leading-snug line-clamp-2" title={copy}>Goes with: “{copy}”</p>
                      : reason
                        ? <p className="text-[10px] text-[var(--color-text-3)] leading-snug line-clamp-2" title={reason}>{reason}</p>
                        : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {regenIdx != null && images[regenIdx] && (
        <RegenImageModal
          runId={runId}
          image={images[regenIdx]}
          prompt={promptFor(images[regenIdx])}
          busy={regenIdx != null && busyIdxs.has(regenIdx)}
          onClose={() => setRegenIdx(null)}
          onRegenerate={(promptText, refs) => regenerate(regenIdx, promptText, productDescription, refs)}
          onUseVersion={(entry) => restoreVersion(regenIdx, entry)}
          candidates={promptFor(images[regenIdx]) ? candidatesFor(promptFor(images[regenIdx])!) : refCandidates}
          initialRefs={promptFor(images[regenIdx]) ? refsFor(promptFor(images[regenIdx])!, refOverrides, heroUrl) : []}
        />
      )}

      {bulkOpen && fixable.length > 0 && (
        <BulkFixModal
          runId={runId}
          failed={fixable}
          promptFor={promptFor}
          candidatesFor={candidatesFor}
          initialRefsFor={(pp) => refsFor(pp, refOverrides, heroUrl)}
          onClose={() => setBulkOpen(false)}
          onRegenerateAll={regenerateAllFailed}
        />
      )}
    </div>
  );
}

// Bulk-fix the failed/flagged images: apply one AI rewrite instruction to every
// failed prompt at once (handy when Higgsfield rejected several for the same
// content-guideline reason), tweak any individually, then regenerate them all.
function BulkFixModal({
  failed,
  promptFor,
  onClose,
  onRegenerateAll,
  runId,
  candidatesFor,
  initialRefsFor,
}: {
  failed: Array<{ im: RemImage; i: number }>;
  promptFor: (im: RemImage) => RemainingPrompt | null;
  onClose: () => void;
  onRegenerateAll: (drafts: Record<number, string>, refsByIdx: Record<number, string[]>) => void;
  runId: number;
  candidatesFor: (p: RemainingPrompt) => RefCandidate[];
  initialRefsFor: (p: RemainingPrompt) => string[];
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    const d: Record<number, string> = {};
    for (const { im, i } of failed) d[i] = promptFor(im)?.prompt ?? "";
    return d;
  });
  // Per-image reference selection, seeded from each image's current refs.
  const [refSel, setRefSel] = useState<Record<number, string[]>>(() => {
    const r: Record<number, string[]> = {};
    for (const { im, i } of failed) {
      const pp = promptFor(im);
      if (pp) r[i] = initialRefsFor(pp);
    }
    return r;
  });
  const toggleBulkRef = (i: number, url: string) => {
    setAiErr(null);
    setRefSel((prev) => {
      const cur = prev[i] ?? [];
      if (cur.includes(url)) {
        if (cur.length <= 1) { setAiErr(`Image #${failed.find((f) => f.i === i)?.im.index ?? ""} needs at least one reference.`); return prev; }
        return { ...prev, [i]: cur.filter((x) => x !== url) };
      }
      return { ...prev, [i]: [...cur, url] };
    });
  };
  const [instr, setInstr] = useState(
    "Reword to pass image-generation content guidelines: remove anything that could be flagged (injury, blood, medical claims, weapons, explicit or unsafe content, real brand names/logos). Keep the product, scene, and text overlay intact.",
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function rewriteAll() {
    const text = instr.trim();
    if (text.length < 5) { setAiErr("Add an instruction first."); return; }
    setAiBusy(true); setAiErr(null);
    try {
      const results = await Promise.all(
        failed.map(async ({ im, i }) => {
          try {
            // Fold in THIS image's own audit reasons so the rewrite targets the
            // specific flag (wrong text, missing product, guideline rejection),
            // not just the generic shared instruction.
            const reasons = reasonsFor(im);
            const perImageInstr = reasons.length
              ? `${text}\n\nThis image was specifically flagged for:\n- ${reasons.join("\n- ")}`
              : text;
            const res = await fetch("/api/stage3/edit-prompt", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: drafts[i], instructions: perImageInstr, category: im.category, run_id: runId }),
            });
            const data = await res.json();
            return { i, prompt: data.success && data.prompt ? (data.prompt as string) : null };
          } catch { return { i, prompt: null }; }
        }),
      );
      const failedCount = results.filter((r) => !r.prompt).length;
      const next = { ...drafts };
      for (const r of results) if (r.prompt) next[r.i] = r.prompt;
      setDrafts(next);
      if (failedCount) {
        // Partial rewrite: stay open so the operator can fix the stragglers —
        // auto-regenerating here would burn credits on unchanged prompts.
        setAiErr(`${failedCount} prompt(s) couldn't be rewritten — edit those manually below, then hit Regenerate all.`);
      } else {
        // Every prompt rewritten — hand straight off to regeneration (closes
        // the modal and runs the batch), no second click needed.
        onRegenerateAll(next, refSel);
      }
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : "Rewrite failed");
    } finally { setAiBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(20,20,18,.06)] p-6 max-w-3xl w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-[15px] font-[640] text-[var(--color-text)]">Fix {failed.length} failed image{failed.length > 1 ? "s" : ""}</h3>
          <p className="text-[11px] text-[var(--color-text-3)] mt-0.5">One instruction for all, or edit each, then regenerate.</p>
        </div>

        {/* Shared AI instruction */}
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
          <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Rewrite all with AI</label>
          <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3} disabled={aiBusy}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          {aiErr && <p className="text-[11px] text-[var(--color-red)]">{aiErr}</p>}
          <button onClick={rewriteAll} disabled={aiBusy}
            className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
            {aiBusy ? "Rewriting all…" : `Rewrite all ${failed.length} & regenerate`}
          </button>
        </div>

        {/* Per-image prompts */}
        <div className="space-y-3">
          {failed.map(({ im, i }) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">#{im.index} · {im.category}</span>
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-widest text-[var(--color-text-4)]">{im.status === "failed" ? "gen failed" : "QC fail"}</span>
              </div>
              {reasonsFor(im).length > 0 && (
                <ul className="rounded-md bg-[var(--color-red-bg)] border border-[var(--color-red)]/25 px-2.5 py-1.5 space-y-0.5">
                  {reasonsFor(im).map((r, k) => (
                    <li key={k} className="text-[10.5px] leading-snug text-[var(--color-red)]">• {r}</li>
                  ))}
                </ul>
              )}
              <textarea
                value={drafts[i] ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [i]: e.target.value }))}
                rows={4}
                className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
              />
              {promptFor(im) && (
                <div className="pt-0.5 space-y-1">
                  <p className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-widest text-[var(--color-text-4)]">Reference images for this shot</p>
                  <RefPicker candidates={candidatesFor(promptFor(im)!)} selected={refSel[i] ?? []} onToggle={(u) => toggleBulkRef(i, u)} disabled={aiBusy} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => onRegenerateAll(drafts, refSel)} disabled={aiBusy} className={btnPrimary}>
            Regenerate all {failed.length}
          </button>
          <button onClick={onClose} disabled={aiBusy} className={btnSecondary}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RegenImageModal({
  image,
  prompt,
  busy,
  onClose,
  onRegenerate,
  onUseVersion,
  runId,
  candidates,
  initialRefs,
}: {
  image: RemImage;
  prompt: RemainingPrompt | null;
  busy: boolean;
  onClose: () => void;
  onRegenerate: (promptText: string, refs: string[]) => void;
  onUseVersion: (entry: { image_url: string; prompt?: string }) => void;
  runId: number;
  candidates: RefCandidate[];
  initialRefs: string[];
}) {
  const issues = image.issues?.filter(Boolean) ?? [];
  // The prompt this image was LAST generated with (edits are persisted after
  // each regenerate), so rewrites build on the current state, not the original.
  const lastUsedPrompt = prompt?.prompt ?? "";
  const [draft, setDraft] = useState(lastUsedPrompt);
  const [aiInstr, setAiInstr] = useState(issues.length ? "Fix the audit issues:\n- " + issues.join("\n- ") : "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false); // prompt was changed since open
  // Which reference images this regeneration will send to Higgsfield.
  const [refs, setRefs] = useState<string[]>(initialRefs);
  const [refErr, setRefErr] = useState<string | null>(null);
  const toggleModalRef = (url: string) => {
    setRefErr(null);
    setRefs((cur) => {
      if (cur.includes(url)) {
        if (cur.length <= 1) { setRefErr("Keep at least one reference."); return cur; }
        return cur.filter((x) => x !== url);
      }
      return [...cur, url];
    });
  };

  // Rewrite the prompt with AI, then immediately regenerate the image with it —
  // rewriting is only ever a step toward a new image, so the second click was
  // pure friction. `draft` is the prompt LAST USED (persisted after each
  // regenerate), so successive rewrites compound instead of starting over.
  async function runAi() {
    const instr = aiInstr.trim();
    if (instr.length < 5) { setAiErr("Tell Claude what to change (5+ chars)"); return; }
    setAiLoading(true); setAiErr(null);
    try {
      const res = await fetch("/api/stage3/edit-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: draft, instructions: instr, category: image.category, run_id: runId }),
      });
      const data = await res.json();
      if (!data.success || !data.prompt) { setAiErr(data.error ?? `HTTP ${res.status}`); return; }
      const rewritten = data.prompt as string;
      setDraft(rewritten);
      setUpdated(true);
      // Hand straight off to generation (this also closes the modal and marks
      // the tile busy). Not in `finally` — on a rewrite failure we keep the
      // modal open with the error instead of generating the unchanged prompt.
      onRegenerate(rewritten, refs);
    } catch (e) { setAiErr(e instanceof Error ? e.message : "Network error"); }
    finally { setAiLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_2px_8px_rgba(20,20,18,.06)] p-6 max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <p className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] uppercase tracking-widest">Image #{image.index} — {image.category}</p>
        {issues.length > 0 && (
          <div className="space-y-1">
            <p className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] uppercase tracking-widest">Audit issues</p>
            {issues.map((iss, k) => <p key={k} className="text-[11px] text-[var(--color-red)]">• {iss}</p>)}
          </div>
        )}
        {/* Previous versions — go back to an earlier generation: use it as-is,
            or load its prompt and edit from there. */}
        {(image.history?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">Previous versions</p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {image.history!.map((h, k) => (
                <div key={k} className="shrink-0 w-[104px] space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.image_url} alt={`Version ${k + 1} back`} loading="lazy" className="w-[104px] h-[104px] object-cover rounded-[8px] border border-[var(--color-border)]" />
                  <button onClick={() => onUseVersion(h)} disabled={busy}
                    className="w-full cursor-pointer rounded px-1.5 py-1 text-[10px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                    Use this image
                  </button>
                  {h.prompt?.trim() && (
                    <button onClick={() => { setDraft(h.prompt!); setUpdated(true); }} disabled={busy || aiLoading}
                      title="Load this version's prompt into the editor below"
                      className="w-full cursor-pointer rounded px-1.5 py-1 text-[10px] font-[620] border border-[var(--color-border)] text-[var(--color-text-2)] hover:text-[var(--color-text)] disabled:opacity-40">
                      Edit from this
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* AI edit */}
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
          <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Edit with AI</label>
          <textarea value={aiInstr} onChange={(e) => setAiInstr(e.target.value)} rows={2} disabled={aiLoading}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          {aiErr && <p className="text-[11px] text-[var(--color-red)]">{aiErr}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runAi} disabled={aiLoading || busy || aiInstr.trim().length < 5}
              title="Rewrites the prompt with your instructions, then regenerates the image straight away"
              className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
              {aiLoading ? "Rewriting…" : "Rewrite prompt & regenerate"}
            </button>
            {updated && !aiLoading && (
              <span className="inline-flex items-center gap-1 text-[11px] font-[620] text-[var(--color-green)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Prompt updated by AI
              </span>
            )}
          </div>
        </div>
        {/* manual prompt */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">Prompt <span className="normal-case tracking-normal text-[var(--color-text-4)]">· last used</span> {updated && <span className="text-[var(--color-green)] normal-case tracking-normal">· edited</span>}</label>
            {updated && (
              <button onClick={() => { setDraft(lastUsedPrompt); setUpdated(false); }} className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline cursor-pointer">Revert</button>
            )}
          </div>
          <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setUpdated(e.target.value !== lastUsedPrompt); }} rows={8}
            className={`w-full border bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] ${updated ? "border-[var(--color-green)]" : "border-[var(--color-border-strong)]"}`} />
        </div>
        {candidates.length > 0 && (
          <div className="space-y-1.5">
            <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">Reference images <span className="normal-case tracking-normal text-[var(--color-text-4)]">· what Higgsfield copies the product from</span></label>
            <RefPicker candidates={candidates} selected={refs} onToggle={toggleModalRef} disabled={busy} />
            {refErr && <p className="text-[11px] text-[var(--color-red)]">{refErr}</p>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={() => onRegenerate(draft, refs)} disabled={busy} className={btnPrimary}>
            {busy ? "Starting…" : updated ? "Regenerate with new prompt" : "Regenerate this image"}
          </button>
          <button onClick={onClose} disabled={busy} className={btnSecondary}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

async function dlImg(url: string, name: string) {
  try {
    const res = await fetch(url); const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    a.click(); URL.revokeObjectURL(a.href);
  } catch { window.open(url, "_blank", "noopener"); }
}

/* ── small presentational helpers ──────────────────────────────────────── */
function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-6">
      <div className="w-3 h-3 rounded-full bg-[var(--color-accent)] animate-pulse" />
      <p className="text-[13px] text-[var(--color-text-2)]">{label}</p>
    </div>
  );
}
/* ── Push a finished run to Shopify as a DRAFT product ───────────────────── */
function ShopifyPush({ runId }: { runId: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ adminUrl: string; imageCount: number } | null>(null);

  const push = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/shopify/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (!data.success) { setErr(data.error || `Push failed (${res.status})`); return; }
      setDone({ adminUrl: data.adminUrl, imageCount: data.imageCount });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--color-green)] bg-[var(--color-green-bg)] px-3 py-2.5 space-y-1">
        <p className="text-[12.5px] font-[600] text-[var(--color-text)]">
          Draft product created in Shopify · {done.imageCount} images
        </p>
        <a
          href={done.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] underline text-[var(--color-text-2)] hover:text-[var(--color-text)]"
        >
          Open in Shopify admin →
        </a>
        <p className="text-[11px] text-[var(--color-text-3)]">Draft — set the price and publish in Shopify.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={push} disabled={busy} className={btnSecondary}>
          {busy ? "Pushing to Shopify…" : "Push to Shopify (draft)"}
        </button>
        <span className="text-[11px] text-[var(--color-text-3)]">
          Copy becomes the product description; hero + the 8 images become product media.
        </span>
      </div>
      {err && <ErrBox msg={err} />}
    </div>
  );
}

/* ── Fullscreen lightbox for Stage 4 images ──────────────────────────────
   Opened from any image tile. Esc or backdrop click closes; ←/→ (keys or the
   on-screen arrows) cycle through every image in the current grid. */
function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: { url: string; label: string }[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const item = items[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && items.length > 1) onIndex((index + 1) % items.length);
      else if (e.key === "ArrowLeft" && items.length > 1) onIndex((index - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
        <span className="text-[11.5px] text-white/80 font-[var(--font-ibm-plex-mono)] uppercase tracking-wider truncate">
          {item.label}{items.length > 1 ? ` · ${index + 1}/${items.length}` : ""}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11.5px] text-white/70 hover:text-white underline underline-offset-2"
          >
            Open original ↗
          </a>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer text-white/80 hover:text-white text-[20px] leading-none px-1.5">
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-3 pb-4">
        {items.length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length); }}
            aria-label="Previous image"
            className="cursor-pointer text-white/60 hover:text-white text-[30px] px-2 shrink-0 select-none"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.label}
          className="max-h-full max-w-full object-contain rounded-md"
          onClick={(e) => e.stopPropagation()}
        />
        {items.length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length); }}
            aria-label="Next image"
            className="cursor-pointer text-white/60 hover:text-white text-[30px] px-2 shrink-0 select-none"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-red)] bg-[var(--color-red-bg)] px-3 py-2 text-[12px] text-[var(--color-text)]">{msg}</div>
  );
}

/* Format-validation badge for the two QC gates. Informational only — a failed
   check never blocks approval; it tells the operator to review carefully. */
function ValidationBadge({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  let v: { passed?: boolean; errors?: string[]; retried?: boolean } | null = null;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v.passed !== "boolean") return null;
  if (v.passed) {
    return (
      <p className="text-[11px] text-[var(--color-green)]">
        ✓ Format checks passed{v.retried ? " (after one retry)" : ""}
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-amber)] bg-[var(--color-amber-bg)] px-3 py-2 space-y-1">
      <p className="text-[12px] font-[600] text-[var(--color-text)]">
        Format checks failed{v.retried ? " (after one retry)" : ""} — review carefully before approving
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {(v.errors ?? []).map((e, i) => (
          <li key={i} className="text-[11px] text-[var(--color-text-2)]">{e}</li>
        ))}
      </ul>
    </div>
  );
}
function GenGrid({ heroUrl, images }: { heroUrl: string | null; images: (RemImage | null)[] }) {
  const [lb, setLb] = useState<number | null>(null);
  async function dl(url: string, name: string) {
    try {
      const res = await fetch(url); const blob = await res.blob();
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      a.click(); URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank", "noopener"); }
  }
  // Every image currently visible in the grid, in display order — the lightbox
  // cycles through these.
  const lbItems = [
    ...(heroUrl ? [{ url: heroUrl, label: "Hero" }] : []),
    ...images.filter((im): im is RemImage => Boolean(im?.image_url)).map((im) => ({ url: im.image_url, label: `#${im.index} ${im.category}` })),
  ];
  const openLb = (url: string) => { const i = lbItems.findIndex((x) => x.url === url); if (i >= 0) setLb(i); };
  return (
    <>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {heroUrl && (
        <div className="aspect-square rounded-[11px] border-2 border-[var(--color-green)] overflow-hidden relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroUrl} alt="Hero" loading="lazy" decoding="async" onClick={() => openLb(heroUrl)} className="w-full h-full object-cover cursor-zoom-in" />
          <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-white px-2 py-0.5 rounded-full">Hero</span>
          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => openLb(heroUrl)} title="View fullscreen" className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">⤢</button>
            <button onClick={() => dl(heroUrl, "01_hero.png")} className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">↓</button>
          </div>
        </div>
      )}
      {images.map((im, i) => (
        <div key={i} className={`aspect-square rounded-[11px] border overflow-hidden relative group ${im?.status === "failed" ? "border-[var(--color-red)]/60 bg-[var(--color-red-bg)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
          {im?.image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.image_url} alt={im.category} loading="lazy" decoding="async" onClick={() => openLb(im.image_url)} className="w-full h-full object-cover cursor-zoom-in" />
              {im.verdict && (
                <span className={`absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide px-2 py-0.5 rounded-full text-white ${im.verdict === "pass" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]"}`}>{im.verdict}</span>
              )}
              <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openLb(im.image_url)} title="View fullscreen" className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">⤢</button>
                <button onClick={() => dl(im.image_url, `${String(im.index).padStart(2, "0")}_${im.category}.png`)} className="text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)] cursor-pointer">↓</button>
              </div>
            </>
          ) : im?.status === "failed" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-2 gap-1 text-center">
              <span className="text-[var(--color-red)] font-[700] text-[10px]">Failed</span>
              <span className="text-[var(--color-text-2)] text-[9px] line-clamp-3">{im.error || "generation failed"}</span>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
            </div>
          )}
        </div>
      ))}
    </div>
    {lb !== null && <Lightbox items={lbItems} index={lb} onClose={() => setLb(null)} onIndex={setLb} />}
    </>
  );
}
