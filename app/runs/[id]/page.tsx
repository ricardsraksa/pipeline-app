"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useRunPolling, type RunStatus } from "@/hooks/useRunPolling";
import { getLastCompletedStage } from "@/lib/pipeline-runner";
import JSZip from "jszip";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStuck(run: RunStatus): boolean {
  if (!run.timestamps.lastUpdatedAt) return false;
  const ageMs = Date.now() - new Date(run.timestamps.lastUpdatedAt).getTime();
  return ageMs > 10 * 60 * 1000 && run.status !== "completed" && run.status !== "awaiting_user" && run.status !== "awaiting_qc";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Starting…",
    scraping: "Scraping",
    stage1: "Stage 1",
    stage2: "Stage 2",
    awaiting_user: "Awaiting input",
    awaiting_qc: "Awaiting QC",
    completed: "Complete",
    failed: "Failed",
  };
  return map[status] ?? status;
}

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />;
  if (status === "failed") return <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />;
  if (status === "awaiting_user" || status === "awaiting_qc")
    return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />;
}

// ── Collapsible output block ──────────────────────────────────────────────────

function OutputBlock({ label, text, filename }: { label: string; text: string; filename: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
      download: filename,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/60">
        <button onClick={() => setOpen(v => !v)} className="cursor-pointer flex items-center gap-2 flex-1 text-left">
          <span className="text-[8px] text-zinc-500">{open ? "▼" : "▶"}</span>
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">{label}</span>
          <span className="text-[10px] text-zinc-600 ml-1">{text.length.toLocaleString()} chars</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}
            className={`cursor-pointer font-mono text-[10px] px-2 py-1 rounded border transition-colors ${copied ? "border-emerald-900/50 text-emerald-400" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
          >
            {copied ? "✓" : "Copy"}
          </button>
          <button onClick={download} className="cursor-pointer font-mono text-[10px] px-2 py-1 rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            ↓ .txt
          </button>
        </div>
      </div>
      {open && (
        <div className="max-h-80 overflow-y-auto bg-zinc-950 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400 leading-relaxed">{text}</pre>
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-16">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-blue-400 uppercase tracking-widest">{label}</span>
        <div className="bg-zinc-800 h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

// ── Running step indicator ────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: string | null }) {
  if (!currentStep) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-950/30 border border-blue-900/40">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
      <span className="text-[12px] font-mono text-blue-300">{currentStep}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const runId = typeof params.id === "string" ? parseInt(params.id, 10) : null;
  const run = useRunPolling(runId);

  const scrolledRef = useRef(false);

  // Auto-scroll to last completed stage on initial load
  useEffect(() => {
    if (!run || scrolledRef.current) return;
    // Only scroll once we have data and pipeline isn't brand new
    if (run.status === "pending") return;
    scrolledRef.current = true;

    const safeRun = {
      generated_images: null,
      image_prompts: null,
      stage2_output: run.outputs.stage2Output,
      step_necessary_beliefs: run.outputs.necessaryBeliefs,
      step_chief_final: run.outputs.chiefFinal,
      scraper_data: run.images.scrapedUrls.length > 0 ? "x" : null,
      step_avatar_revised: run.outputs.avatarRevised,
    } as Parameters<typeof getLastCompletedStage>[0];

    const lastStage = getLastCompletedStage(safeRun as any);
    const targetId: Record<string, string> = {
      "stage3-images": "stage-3-section",
      "stage3-prompts": "stage-3-section",
      "stage2": "stage-2-section",
      "stage1": "stage-1-section",
      "scrape": "scrape-section",
    };
    if (targetId[lastStage]) {
      setTimeout(() => {
        document.getElementById(targetId[lastStage])?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  }, [run?.status]);

  async function handleResume() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
    // Polling will pick up the new status automatically
    window.location.reload();
  }

  async function handleDownloadAll() {
    if (!run) return;
    const slug = run.meta.brandName ?? run.meta.productName ?? `run_${runId}`;
    const zip = new JSZip();
    const { outputs } = run;
    const files: [string | null, string][] = [
      [outputs.research,                  `${slug}_RESEARCH.txt`],
      [outputs.chiefMid,                  `${slug}_CHIEF_MID.txt`],
      [outputs.researchRevised,           `${slug}_RESEARCH_REVISED.txt`],
      [outputs.avatar,                    `${slug}_AVATAR.txt`],
      [outputs.avatarRevised,             `${slug}_AVATAR_REVISED.txt`],
      [outputs.offerBrief,                `${slug}_OFFER_BRIEF.txt`],
      [outputs.offerBriefRevised,         `${slug}_OFFER_BRIEF_REVISED.txt`],
      [outputs.necessaryBeliefs,          `${slug}_NECESSARY_BELIEFS.txt`],
      [outputs.necessaryBeliefsRevised,   `${slug}_NECESSARY_BELIEFS_REVISED.txt`],
      [outputs.chiefFinal,                `${slug}_CHIEF_FINAL.txt`],
      [outputs.stage2Output,              `${slug}_STAGE2_GERMAN_COPY.txt`],
    ];
    for (const [content, name] of files) if (content) zip.file(name, content);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${slug}_run_${runId}.zip`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  if (!run) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="max-w-4xl mx-auto px-5 pt-12">
          <div className="flex items-center gap-3 text-zinc-600 text-sm">
            <span className="w-2 h-2 rounded-full bg-zinc-700 animate-pulse" />
            Loading run…
          </div>
        </div>
      </main>
    );
  }

  const { outputs } = run;
  const hasAnyOutput = Object.values(outputs).some(Boolean);
  const isFailed = run.status === "failed";
  const isStuckRun = isStuck(run);
  const showResumeBanner = isFailed || isStuckRun;
  const isActive = !["completed", "failed", "awaiting_user", "awaiting_qc"].includes(run.status);
  const displayName = run.meta.brandName ?? run.meta.productName ?? `Run #${runId}`;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">

      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" className="text-zinc-600 hover:text-zinc-300 transition-colors text-[11px] font-mono">← Pipeline</Link>
            <span className="text-zinc-700">/</span>
            <span className="text-[12px] font-mono text-zinc-400 truncate max-w-[200px]">{displayName}</span>
            {run.meta.brandName && (
              <>
                <span className="text-zinc-700">#</span>
                <span className="text-[11px] font-mono text-zinc-600">{runId}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isActive && run.currentStep && (
              <span className="hidden md:inline text-[10px] font-mono text-zinc-500 truncate max-w-[240px]">{run.currentStep}</span>
            )}
            <div className="flex items-center gap-1.5">
              <StatusDot status={run.status} />
              <span className="text-[11px] font-mono text-zinc-400">{statusLabel(run.status)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6 space-y-8">

        {/* Resume banner */}
        {showResumeBanner && (
          <div className="px-4 py-3 rounded-lg bg-amber-950/30 border border-amber-800/50 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 flex-shrink-0 text-sm mt-px">!</span>
              <div className="flex-1">
                <p className="text-[12px] font-mono text-amber-300">
                  {isFailed ? "Run failed" : "Run appears stuck"} at: {run.currentStep ?? "unknown step"}
                </p>
                {run.error && <p className="text-[11px] text-amber-200/70 mt-1">{run.error}</p>}
              </div>
            </div>
            <div className="pl-5">
              <button
                onClick={handleResume}
                className="cursor-pointer px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[12px] font-medium transition-colors active:scale-95"
              >
                Resume pipeline
              </button>
            </div>
          </div>
        )}

        {/* Active step indicator */}
        {isActive && <StepIndicator currentStep={run.currentStep} />}

        {/* Run info */}
        <Section id="scrape-section" label="Run">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
            <div className="flex items-start gap-4 px-4 py-3">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-24 flex-shrink-0 pt-0.5">URL</span>
              <a href={run.meta.productUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline break-all">{run.meta.productUrl}</a>
            </div>
            {run.images.scrapedUrls.length > 0 && (
              <div className="px-4 py-3">
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                  Scraped images · {run.images.scrapedUrls.length}
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {run.images.scrapedUrls.slice(0, 10).map((u, i) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Stage 1 outputs */}
        {(outputs.research || run.status === "stage1" || run.status === "scraping") && (
          <Section id="stage-1-section" label="Stage 1 — Research">
            {isActive && run.status === "stage1" && <StepIndicator currentStep={run.currentStep} />}
            <div className="space-y-2">
              {outputs.research && <OutputBlock label="Research Brief" text={outputs.research} filename="RESEARCH.txt" />}
              {outputs.chiefMid && <OutputBlock label="Mid Chief Review" text={outputs.chiefMid} filename="CHIEF_MID.txt" />}
              {outputs.researchRevised && <OutputBlock label="Research (Revised)" text={outputs.researchRevised} filename="RESEARCH_REVISED.txt" />}
              {outputs.avatar && <OutputBlock label="Customer Avatar" text={outputs.avatar} filename="AVATAR.txt" />}
              {outputs.offerBrief && <OutputBlock label="Offer Brief" text={outputs.offerBrief} filename="OFFER_BRIEF.txt" />}
              {outputs.necessaryBeliefs && <OutputBlock label="Necessary Beliefs" text={outputs.necessaryBeliefs} filename="NECESSARY_BELIEFS.txt" />}
              {outputs.chiefFinal && <OutputBlock label="Final Chief Review" text={outputs.chiefFinal} filename="CHIEF_FINAL.txt" />}
              {outputs.avatarRevised && outputs.avatarRevised !== outputs.avatar && (
                <OutputBlock label="Avatar (Revised)" text={outputs.avatarRevised} filename="AVATAR_REVISED.txt" />
              )}
              {outputs.offerBriefRevised && outputs.offerBriefRevised !== outputs.offerBrief && (
                <OutputBlock label="Offer Brief (Revised)" text={outputs.offerBriefRevised} filename="OFFER_BRIEF_REVISED.txt" />
              )}
              {outputs.necessaryBeliefsRevised && outputs.necessaryBeliefsRevised !== outputs.necessaryBeliefs && (
                <OutputBlock label="Necessary Beliefs (Revised)" text={outputs.necessaryBeliefsRevised} filename="NECESSARY_BELIEFS_REVISED.txt" />
              )}
              {!outputs.research && (
                <div className="px-4 py-8 text-center text-zinc-600 text-[12px] font-mono">
                  {run.status === "scraping" ? "Scraping product page…" : "Waiting for outputs…"}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Stage 2 output */}
        {(outputs.stage2Output || run.status === "stage2") && (
          <Section id="stage-2-section" label="Stage 2 — German Copy">
            {run.status === "stage2" && <StepIndicator currentStep={run.currentStep} />}
            {outputs.stage2Output && (
              <OutputBlock label="German Copy Kit" text={outputs.stage2Output} filename="STAGE2_GERMAN_COPY.txt" />
            )}
          </Section>
        )}

        {/* Stage 3 gate — shown when awaiting_user */}
        {(run.status === "awaiting_user" || run.status === "awaiting_qc" || run.status === "completed") && (
          <Section id="stage-3-section" label="Stage 3 — Images">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
              {run.status === "awaiting_user" ? (
                <>
                  <p className="text-[12px] text-zinc-300">
                    Approve product images and optionally add reference images, then launch Stage 3.
                  </p>
                  <Link
                    href={`/stage3?runId=${runId}`}
                    className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium rounded-md transition-colors"
                  >
                    Open Stage 3 →
                  </Link>
                </>
              ) : run.status === "awaiting_qc" ? (
                <p className="text-[12px] text-zinc-400 font-mono">Awaiting prompt review + QC</p>
              ) : (
                <p className="text-[12px] text-emerald-400 font-mono">Stage 3 complete. View images in Stage 3 page.</p>
              )}
            </div>
          </Section>
        )}

        {/* Download all */}
        {hasAnyOutput && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleDownloadAll}
              className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[13px] font-medium transition-colors"
            >
              ↓ Download All (.zip)
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
