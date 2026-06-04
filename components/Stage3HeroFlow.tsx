"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/db";

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
  german_text: string;
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
        body: JSON.stringify({ prompt: heroDraft, instructions: instr, category: "hero_studio" }),
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
  const [genIndex, setGenIndex] = useState<number | null>(null);
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
        <button
          disabled={!stage2Ready || busy !== null}
          onClick={() => trigger("/api/stage3-hero-prompt", { runId }, "hero")}
          className={btnPrimary}
        >
          {busy === "hero" ? "Generating hero…" : "Generate Stage 3 — Hero first →"}
        </button>
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

    const generateAll = async () => {
      if (!heroUrl) return;
      setErr(null);
      setBusy("generate-8");
      const results: (RemImage | null)[] = saved.map(() => null);
      setGenImages(results);
      // Persist any prompt edits first.
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_remaining_prompts_edited: JSON.stringify(saved) }),
      }).catch(() => {});

      const productDesc = run.product_description ?? run.product_name ?? "";
      stopRef.current = false;
      for (let i = 0; i < saved.length; i++) {
        if (stopRef.current) break;
        const p = saved[i];
        setGenIndex(i);
        try {
          const gen = await fetch("/api/stage3/generate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: p.prompt, model: p.model, reference_images: [heroUrl], aspect_ratio: p.aspect_ratio }),
          }).then((r) => r.json());
          if (!gen.success) throw new Error(gen.error || "generation failed");

          let verdict: "pass" | "fail" = "pass";
          let issues: string[] = [];
          try {
            const audit = await fetch("/api/stage3/audit", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_url: gen.image_url, category: p.category, prompt_used: p.prompt, product_description: productDesc, german_text_used: p.german_text || null }),
            }).then((r) => r.json());
            if (audit.success) {
              verdict = audit.result?.verdict === "pass" ? "pass" : "fail";
              issues = audit.result?.issues ?? [];
            }
          } catch { /* audit optional */ }

          results[i] = { index: p.index, category: p.category, image_url: gen.image_url, status: "done", verdict, issues };
        } catch (e) {
          results[i] = { index: p.index, category: p.category, image_url: "", status: "failed", error: e instanceof Error ? e.message : String(e) };
        }
        setGenImages([...results]);
      }
      setGenIndex(null);
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage3_remaining_images: JSON.stringify(results), status: "completed" }),
      }).catch(() => {});
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
            {genIndex != null ? `Image ${genIndex + 2} of 9` : "Finishing…"} · all referencing the approved hero
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
        {err && <ErrBox msg={err} />}
        <div className="space-y-3">
          {saved.map((p, i) => (
            <div key={i} className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-[600] text-[var(--color-text)]">#{p.index} {p.image_type || p.category}</span>
                <span className="font-[var(--font-ibm-plex-mono)] text-[9px] bg-[var(--color-surface-2)] text-[var(--color-text-2)] border border-[var(--color-border)] px-2 py-0.5 rounded">{p.model}</span>
                {p.german_text && <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-3)] truncate max-w-xs">DE: {p.german_text}</span>}
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
        <button disabled={busy !== null} onClick={generateAll} className={btnPrimary}>
          Generate 8 Images →
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
    return (
      <div className="space-y-3">
        <h3 className="text-[15px] font-[600] text-[var(--color-text)]">
          {heroUrl ? "Stage 3 complete · hero + 8 derivatives" : "Stage 3 images"}
        </h3>
        <GenGrid heroUrl={heroUrl} images={imgs} />
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
          <img src={heroUrl} alt="Hero" className="w-full h-full object-cover" />
          <span className="absolute top-2 left-2 text-[9px] font-[700] uppercase tracking-wide bg-[var(--color-green)] text-white px-2 py-0.5 rounded-full">Hero</span>
          <button onClick={() => dl(heroUrl, "01_hero.png")} className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] bg-white/15 hover:bg-white/25 text-white px-2 py-1 rounded font-[var(--font-ibm-plex-mono)]">↓</button>
        </div>
      )}
      {images.map((im, i) => (
        <div key={i} className={`aspect-square rounded-[11px] border overflow-hidden relative group ${im?.status === "failed" ? "border-[var(--color-red)]/60 bg-[var(--color-red-bg)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
          {im?.image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.image_url} alt={im.category} className="w-full h-full object-cover" />
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
