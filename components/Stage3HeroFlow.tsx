"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/db";
import Stage3ReferenceImages from "@/components/Stage3ReferenceImages";

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
}

interface Placement {
  section_1: number;
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

// Human-readable label for each Stage 3 image template, so the operator knows
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
  /** Stage 2 is done — Stage 3 is allowed to start. */
  stage2Ready: boolean;
}) {
  const [run, setRun] = useState<Run | null>(null);
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
        body: JSON.stringify({ prompt: heroDraft, instructions: instr, category: "hero_studio", reference_images: safeParse<string[]>(run?.stage3_reference_images, []) }),
      });
      const data = await res.json();
      if (!data.success || !data.prompt) { setHeroAiErr(data.error ?? `HTTP ${res.status}`); return; }
      setHeroDraft(data.prompt as string);
      setHeroAiInstr("");
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
    return <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading Stage 3…</p>;
  }

  const heroPrompt = safeParse<HeroPrompt | null>(run.stage3_hero_prompt, null);
  const heroPromptText = (run.stage3_hero_prompt_edited?.trim() || heroPrompt?.prompt || "");
  const heroUrl = run.stage3_hero_image_url;
  // Backward compat: a run completed under the OLD Stage 3 path stores its
  // images in `generated_images`. Treat that as "already has Stage 3" so we
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
        <p className="text-[13px] text-[var(--color-text-2)]">
          Stage 3 generates a <strong>hero shot first</strong> from your source product photos. You approve it, then the other 8 images are built using the approved hero as the reference — so the product stays consistent.
        </p>
        {err && <ErrBox msg={err} />}
        <div className="flex gap-3 flex-wrap items-center">
          <button
            disabled={!stage2Ready || busy !== null}
            onClick={() => trigger("/api/stage3-hero-prompt", { runId }, "hero")}
            className={btnPrimary}
          >
            {busy === "hero" ? "Generating hero…" : "Generate Stage 3 — Hero first →"}
          </button>
          <button
            disabled={!stage2Ready || busy !== null}
            onClick={() => trigger("/api/stage3/skip-hero", { runId }, "skip")}
            className={btnSecondary}
          >
            {busy === "skip" ? "Writing prompts…" : "Skip hero — use source images"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-3)] max-w-md">
          “Skip hero” builds the 8 images straight from your source product photos as the reference, instead of generating and approving a hero shot first.
        </p>
        {!stage2Ready && <p className="text-[11px] text-[var(--color-text-3)]">Finish Stage 2 first.</p>}
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
        <img src={heroUrl} alt="Hero" className="rounded-lg max-w-md w-full border border-[var(--color-border)]" />
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
                {heroAiLoading ? "Rewriting…" : "Rewrite prompt"}
              </button>
            </div>

            <Stage3ReferenceImages runId={Number(runId)} initial={safeParse<string[]>(run.stage3_reference_images, [])} />

            <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">Hero prompt (scene / lighting only — appearance comes from the photos)</label>
            <textarea
              value={heroDraft}
              onChange={(e) => setHeroDraft(e.target.value)}
              rows={10}
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
            />
            <button
              disabled={busy !== null}
              onClick={() => trigger("/api/stage3/hero-regenerate", { runId, editedPrompt: heroDraft }, "regen-hero").then(() => setHeroEditing(false))}
              className={btnPrimary}
            >
              {busy === "regen-hero" ? "Regenerating…" : "Regenerate with this prompt"}
            </button>
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
    const setDraft = (i: number, prompt: string) => {
      const next = saved.map((p, j) => (j === i ? { ...p, prompt } : p));
      setPromptDrafts(next);
    };

    // Images already generated in a previous (interrupted) pass — the loop
    // skips these and resumes from the first missing one.
    const existing = safeParse<RemImage[]>(run.stage3_remaining_images, []);
    const doneByIndex = new Map(existing.filter((im) => im?.status === "done" && im.image_url).map((im) => [im.index, im]));

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
          // Reference the image(s) this prompt was built around: the approved
          // hero, or the source product photos when the hero step was skipped.
          const refs = p.source_image_references?.length ? p.source_image_references : (heroUrl ? [heroUrl] : []);
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
              body: JSON.stringify({ image_url: gen.image_url, category: p.category, prompt_used: p.prompt, product_description: productDesc, overlay_text_used: p.overlay_text || null }),
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
        // Images are already persisted per-image; just flip the status.
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
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
          <p className="text-[12px] text-[var(--color-text-3)]">Edit any prompt before generating. Each references the approved hero — they handle scene, lighting, and text only.</p>
        </div>
        <ValidationBadge raw={run.stage3_remaining_validation} />
        {err && <ErrBox msg={err} />}
        <div className="space-y-3">
          {saved.map((p, i) => (
            <div key={i} className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-[600] text-[var(--color-text)]">#{p.index} {p.image_type || p.category}</span>
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] border border-[var(--color-border)] px-2 py-0.5 rounded">{p.model}</span>
                {p.overlay_text && <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] truncate max-w-xs">Text: {p.overlay_text}</span>}
              </div>
              <textarea
                value={p.prompt}
                onChange={(e) => setDraft(i, e.target.value)}
                rows={5}
                className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
              />
            </div>
          ))}
        </div>
        {doneByIndex.size > 0 && (
          <p className="text-[12px] text-[var(--color-amber)]">
            {doneByIndex.size} of {saved.length} images were already generated in an interrupted pass — generation resumes from the rest.
          </p>
        )}
        <button disabled={busy !== null} onClick={generateAll} className={btnPrimary}>
          {doneByIndex.size > 0 ? `Resume generation (${doneByIndex.size}/${saved.length} done) →` : "Generate 8 Images →"}
        </button>
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
      <CompletedReview
        runId={runId}
        heroUrl={heroUrl}
        initialImages={imgs}
        prompts={prompts}
        initialPlacement={placement}
        initialReferenceImages={referenceImages}
      />
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
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">Stage 3 images ({imgs.length})</h3>
        <p className="text-[11px] text-[var(--color-text-3)]">Generated on the previous Stage 3 flow.</p>
        <GenGrid heroUrl={null} images={imgs} />
        <a
          href={`/stage3?runId=${runId}`}
          className={btnSecondary + " no-underline"}
        >
          Open in Stage 3 editor →
        </a>
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
        <ErrBox msg={`${what} — the generation step was interrupted. Restart Stage 3 to try again from the start.`} />
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy !== null} onClick={restart} className={btnPrimary}>
            {busy === "recover" ? "Restarting…" : "Restart Stage 3"}
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
      <p className="text-[12px] text-[var(--color-text-3)]">Stage 3 status: {status || "unknown"}.</p>
      <button disabled={busy !== null} onClick={fetchRun} className={btnSecondary}>Refresh</button>
    </div>
  );
}

/* ── Completed review: per-image verdict override, fail reason, regenerate ── */
function CompletedReview({
  runId,
  heroUrl,
  initialImages,
  prompts,
  initialPlacement,
  initialReferenceImages,
}: {
  runId: number;
  heroUrl: string | null;
  initialImages: RemImage[];
  prompts: RemainingPrompt[];
  initialPlacement: Placement | null;
  initialReferenceImages: string[];
}) {
  const [images, setImages] = useState<RemImage[]>(initialImages);
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
    if (!placement && usable.length >= 3) { autoTried.current = true; runPlacement(); }
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
  const regenerate = async (i: number, newPromptText: string, productDesc: string) => {
    const im = images[i];
    const p = promptFor(im);
    if (!p) return;
    // Close the modal right away and flip the tile into a generating state so
    // the operator gets immediate feedback while the (slow) gen+audit runs.
    setRegenIdx(null);
    setBusyIdxs((s) => new Set(s).add(i));
    try {
      const refs = p.source_image_references?.length ? p.source_image_references : (heroUrl ? [heroUrl] : []);
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
          body: JSON.stringify({ image_url: gen.image_url, category: p.category, prompt_used: newPromptText, product_description: productDesc, overlay_text_used: p.overlay_text || null }),
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
        const updated: RemImage = { index: cur.index, category: cur.category, image_url: gen.image_url, status: "done", verdict, issues, user_override: null };
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
  const regenerateAllFailed = async (drafts: Record<number, string>) => {
    setBulkOpen(false);
    setBulkRunning(true);
    try {
      const targets = images
        .map((im, i) => ({ im, i }))
        .filter(({ im }) => im.status === "failed" || effVerdict(im) === "fail")
        .map(({ im, i }) => ({ i, text: drafts[i] ?? promptFor(im)?.prompt ?? "", cat: im.category }))
        .filter((t) => t.text);
      const CONCURRENCY = 3;
      const queue = [...targets];
      const worker = async () => {
        for (;;) {
          const t = queue.shift();
          if (!t) break;
          await regenerate(t.i, t.text, t.cat);
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
        { section: 1, index: placement.section_1 },
        { section: 2, index: placement.section_2 },
        { section: 3, index: placement.section_3 },
      ]
    : [];
  const pickedIndexes = new Set(sectionPicks.map((s) => s.index));
  const sectionEntries = sectionPicks
    .map((s) => ({ ...s, entry: entries.find((e) => e.im.index === s.index) }))
    .filter((s): s is { section: number; index: number; entry: { im: RemImage; i: number } } => !!s.entry);
  const productEntries = entries.filter((e) => !pickedIndexes.has(e.im.index));

  // Render one interactive image tile (verdict badge, regenerate, fail banner,
  // generating overlay). Index `i` is the position in the `images` array so
  // toggleVerdict/regenerate stay correct after regrouping.
  const renderTile = (im: RemImage, i: number) => {
    const v = effVerdict(im);
    const failReason = im.status === "failed" ? (im.error || "generation failed") : (im.issues?.filter(Boolean)[0] || "");
    const overridden = im.user_override != null;
    const regenerating = busyIdxs.has(i);
    return (
      <div className={`aspect-square rounded-[11px] border overflow-hidden relative group ${v === "fail" || im.status === "failed" ? "border-[var(--color-red)]/60" : "border-[var(--color-border)]"} bg-[var(--color-surface)]`}>
        {regenerating && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/65 backdrop-blur-[2px]">
            <div className="w-4 h-4 rounded-full bg-white animate-pulse" />
            <span className="text-[10px] text-white font-[var(--font-ibm-plex-mono)] uppercase tracking-wide">Generating…</span>
          </div>
        )}
        {im.image_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.image_url} alt={im.category} loading="lazy" decoding="async" className={`w-full h-full object-cover ${v === "fail" ? "opacity-80" : ""}`} />
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
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">{heroUrl ? "Stage 3 complete · hero + 8" : "Stage 3 images"}</h3>
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
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
        <p className="text-[11px] text-[var(--color-text-3)] max-w-xl">The AI looked at the images and placed one lifestyle/benefit shot into each of the 3 body sections (hook → solution → reassurance). Everything else is a product shot for the top of the page.</p>
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
                <img src={heroUrl} alt="Hero" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-white px-2 py-0.5 rounded-full">Hero</span>
                <button onClick={() => dlImg(heroUrl, "01_hero.png")} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)]">↓</button>
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
          image={images[regenIdx]}
          prompt={promptFor(images[regenIdx])}
          busy={regenIdx != null && busyIdxs.has(regenIdx)}
          onClose={() => setRegenIdx(null)}
          onRegenerate={(promptText) => regenerate(regenIdx, promptText, images[regenIdx].category)}
        />
      )}

      {bulkOpen && fixable.length > 0 && (
        <BulkFixModal
          failed={fixable}
          promptFor={promptFor}
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
}: {
  failed: Array<{ im: RemImage; i: number }>;
  promptFor: (im: RemImage) => RemainingPrompt | null;
  onClose: () => void;
  onRegenerateAll: (drafts: Record<number, string>) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    const d: Record<number, string> = {};
    for (const { im, i } of failed) d[i] = promptFor(im)?.prompt ?? "";
    return d;
  });
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
              body: JSON.stringify({ prompt: drafts[i], instructions: perImageInstr, category: im.category }),
            });
            const data = await res.json();
            return { i, prompt: data.success && data.prompt ? (data.prompt as string) : null };
          } catch { return { i, prompt: null }; }
        }),
      );
      const failedCount = results.filter((r) => !r.prompt).length;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.prompt) next[r.i] = r.prompt;
        return next;
      });
      if (failedCount) setAiErr(`${failedCount} prompt(s) couldn't be rewritten — edit those manually below.`);
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
          <p className="text-[11px] text-[var(--color-text-3)] mt-0.5">Apply one instruction to every failed prompt, edit any individually, then regenerate them all.</p>
        </div>

        {/* Shared AI instruction */}
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
          <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Rewrite all with AI</label>
          <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3} disabled={aiBusy}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          {aiErr && <p className="text-[11px] text-[var(--color-red)]">{aiErr}</p>}
          <button onClick={rewriteAll} disabled={aiBusy}
            className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
            {aiBusy ? "Rewriting all…" : `Rewrite all ${failed.length} prompts`}
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
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => onRegenerateAll(drafts)} disabled={aiBusy} className={btnPrimary}>
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
}: {
  image: RemImage;
  prompt: RemainingPrompt | null;
  busy: boolean;
  onClose: () => void;
  onRegenerate: (promptText: string) => void;
}) {
  const issues = image.issues?.filter(Boolean) ?? [];
  const originalPrompt = prompt?.prompt ?? "";
  const [draft, setDraft] = useState(originalPrompt);
  const [aiInstr, setAiInstr] = useState(issues.length ? "Fix the audit issues:\n- " + issues.join("\n- ") : "");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false); // prompt was changed since open

  async function runAi() {
    const instr = aiInstr.trim();
    if (instr.length < 5) { setAiErr("Tell Claude what to change (5+ chars)"); return; }
    setAiLoading(true); setAiErr(null);
    try {
      const res = await fetch("/api/stage3/edit-prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: draft, instructions: instr, category: image.category }),
      });
      const data = await res.json();
      if (!data.success || !data.prompt) { setAiErr(data.error ?? `HTTP ${res.status}`); return; }
      setDraft(data.prompt as string);
      setUpdated(true);
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
        {/* AI edit */}
        <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-accent-weak)] p-3 space-y-2">
          <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-accent-text)]">Edit with AI</label>
          <textarea value={aiInstr} onChange={(e) => setAiInstr(e.target.value)} rows={2} disabled={aiLoading}
            className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[12px] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]" />
          {aiErr && <p className="text-[11px] text-[var(--color-red)]">{aiErr}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runAi} disabled={aiLoading || aiInstr.trim().length < 5}
              className="cursor-pointer inline-flex items-center gap-[6px] rounded-md px-[12px] py-[7px] text-[12px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
              {aiLoading ? "Rewriting…" : "Rewrite prompt"}
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
            <label className="font-[var(--font-ibm-plex-mono)] text-[10px] uppercase tracking-widest text-[var(--color-text-3)]">Prompt {updated && <span className="text-[var(--color-green)] normal-case tracking-normal">· edited</span>}</label>
            {updated && (
              <button onClick={() => { setDraft(originalPrompt); setUpdated(false); }} className="text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline cursor-pointer">Revert</button>
            )}
          </div>
          <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setUpdated(e.target.value !== originalPrompt); }} rows={8}
            className={`w-full border bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-3 py-2 text-[11px] font-[var(--font-ibm-plex-mono)] resize-y focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] ${updated ? "border-[var(--color-green)]" : "border-[var(--color-border-strong)]"}`} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => onRegenerate(draft)} disabled={busy} className={btnPrimary}>
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
  async function dl(url: string, name: string) {
    try {
      const res = await fetch(url); const blob = await res.blob();
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      a.click(); URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank", "noopener"); }
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {heroUrl && (
        <div className="aspect-square rounded-[11px] border-2 border-[var(--color-green)] overflow-hidden relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroUrl} alt="Hero" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-white px-2 py-0.5 rounded-full">Hero</span>
          <button onClick={() => dl(heroUrl, "01_hero.png")} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)]">↓</button>
        </div>
      )}
      {images.map((im, i) => (
        <div key={i} className={`aspect-square rounded-[11px] border overflow-hidden relative group ${im?.status === "failed" ? "border-[var(--color-red)]/60 bg-[var(--color-red-bg)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
          {im?.image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.image_url} alt={im.category} loading="lazy" decoding="async" className="w-full h-full object-cover" />
              {im.verdict && (
                <span className={`absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide px-2 py-0.5 rounded-full text-white ${im.verdict === "pass" ? "bg-[var(--color-green)]" : "bg-[var(--color-red)]"}`}>{im.verdict}</span>
              )}
              <button onClick={() => dl(im.image_url, `${String(im.index).padStart(2, "0")}_${im.category}.png`)} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)]">↓</button>
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
  );
}
