"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRunPolling, type RunStatus } from "@/hooks/useRunPolling";
import { Icon } from "@/components/ui/Icon";
import JSZip from "jszip";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Stage = "scrape" | "stage1" | "stage2" | "stage3";
type StageState = "pending" | "running" | "complete" | "error" | "waiting";

function getStageState(run: RunStatus, stage: Stage): StageState {
  const isFailed = run.status === "failed";
  const failedAt: Stage | null =
    !isFailed
      ? null
      : run.status === "failed"
        ? // Determine where it failed based on what outputs exist
          run.outputs.stage2Output
          ? "stage3"
          : run.outputs.research
            ? "stage2"
            : run.images.scrapedUrls.length > 0
              ? "stage1"
              : "scrape"
        : null;

  if (failedAt === stage) return "error";

  switch (stage) {
    case "scrape":
      if (run.images.scrapedUrls.length > 0 || run.outputs.research) return "complete";
      if (run.status === "scraping") return "running";
      if (run.status === "pending") return "pending";
      return "pending";
    case "stage1":
      if (run.outputs.necessaryBeliefs || run.outputs.chiefFinal) return "complete";
      if (run.status === "stage1") return "running";
      if (run.outputs.research) return "running";
      return "pending";
    case "stage2":
      if (run.outputs.stage2Output) return "complete";
      if (run.status === "stage2") return "running";
      return "pending";
    case "stage3":
      if (run.status === "completed") return "complete";
      if (run.status === "awaiting_user") return "waiting";
      if (run.status === "awaiting_qc") return "running";
      return "pending";
  }
}

type LastStage = "none" | "scrape" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

function getLastCompletedStage(run: RunStatus): LastStage {
  if (run.outputs.stage2Output && run.status === "completed") return "stage3-images";
  if (run.status === "awaiting_qc") return "stage3-prompts";
  if (run.outputs.stage2Output) return "stage2";
  if (run.outputs.necessaryBeliefs || run.outputs.chiefFinal) return "stage1";
  if (run.images.scrapedUrls.length > 0) return "scrape";
  return "none";
}

function isStuck(run: RunStatus): boolean {
  if (!run.timestamps.lastUpdatedAt) return false;
  const ageMs = Date.now() - new Date(run.timestamps.lastUpdatedAt).getTime();
  return (
    ageMs > 10 * 60 * 1000 &&
    !["completed", "failed", "awaiting_user", "awaiting_qc"].includes(run.status)
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Starting…",
    scraping: "Scraping",
    stage1: "Stage 1 — Research",
    stage2: "Stage 2 — Copy",
    awaiting_user: "Awaiting review",
    awaiting_qc: "Awaiting QC",
    completed: "Complete",
    failed: "Failed",
  };
  return map[status] ?? status;
}

function elapsedTime(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

// ── Components ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const dot = (cls: string, pulse = false) => (
    <span className={`w-1.5 h-1.5 rounded-full ${cls} ${pulse ? "pulse-dot" : ""} flex-shrink-0`} aria-hidden />
  );
  if (status === "completed") return dot("bg-[var(--color-success)]");
  if (status === "failed") return dot("bg-[var(--color-error)]");
  if (status === "awaiting_user" || status === "awaiting_qc") return dot("bg-[var(--color-warn)]");
  return dot("bg-[var(--color-accent)]", true);
}

function PipelineProgress({ run }: { run: RunStatus }) {
  const stages: { key: Stage; label: string }[] = [
    { key: "scrape", label: "Scrape" },
    { key: "stage1", label: "Research" },
    { key: "stage2", label: "Copy" },
    { key: "stage3", label: "Images" },
  ];

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
      <div className="flex items-center gap-2">
        {stages.map((s, i) => {
          const state = getStageState(run, s.key);
          const tone =
            state === "complete"
              ? "bg-[var(--color-success)] text-[var(--color-bg)]"
              : state === "running"
                ? "bg-[var(--color-accent)] text-white"
                : state === "error"
                  ? "bg-[var(--color-error)] text-white"
                  : state === "waiting"
                    ? "bg-[var(--color-warn)] text-[var(--color-bg)]"
                    : "bg-[var(--color-surface-2)] text-[var(--color-text-4)] border border-[var(--color-border)]";

          const labelTone =
            state === "pending"
              ? "text-[var(--color-text-4)]"
              : state === "running"
                ? "text-[var(--color-accent)]"
                : state === "error"
                  ? "text-[var(--color-error)]"
                  : state === "waiting"
                    ? "text-[var(--color-warn)]"
                    : "text-[var(--color-text)]";

          const connectorTone =
            state === "complete" ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]";

          return (
            <div key={s.key} className="flex items-center gap-2 flex-1 min-w-0 last:flex-initial">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`grid place-items-center w-5 h-5 rounded-md text-[10px] font-mono font-medium flex-shrink-0 ${tone}`}
                  aria-label={`${s.label}: ${state}`}
                >
                  {state === "complete" ? (
                    <Icon.Check className="w-3 h-3" strokeWidth={3} />
                  ) : state === "running" ? (
                    <Icon.Loader className="w-3 h-3" />
                  ) : state === "error" ? (
                    <Icon.X className="w-3 h-3" strokeWidth={3} />
                  ) : state === "waiting" ? (
                    <span className="text-[10px]">!</span>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={`text-[11px] font-mono uppercase tracking-[0.12em] truncate ${labelTone}`}>
                  {s.label}
                </span>
              </div>
              {i < stages.length - 1 && (
                <div className={`flex-1 h-px ${connectorTone} transition-colors duration-300`} />
              )}
            </div>
          );
        })}
      </div>

      {run.currentStep && !["completed", "failed", "awaiting_user", "awaiting_qc"].includes(run.status) && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
          <Icon.Loader className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <span className="font-mono text-[11px] text-[var(--color-text-2)] truncate">{run.currentStep}</span>
        </div>
      )}
    </div>
  );
}

// ── Output block ──────────────────────────────────────────────────────────────

function OutputBlock({ label, text, filename }: { label: string; text: string; filename: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 h-10 hover:bg-[var(--color-surface-2)]/40 transition-colors duration-150">
        <button
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer flex items-center gap-2 flex-1 text-left min-w-0"
          aria-expanded={open}
        >
          <Icon.ChevronRight
            className={`w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          <Icon.Doc className="w-3.5 h-3.5 text-[var(--color-text-3)] flex-shrink-0" />
          <span className="text-[12px] text-[var(--color-text)] truncate">{label}</span>
          <span className="font-mono text-[10px] text-[var(--color-text-4)] flex-shrink-0">
            {text.length.toLocaleString()} chars
          </span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={copy}
            className={[
              "cursor-pointer inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-mono border transition-colors duration-150",
              copied
                ? "border-[color:rgb(58_117_84_/_0.35)] text-[var(--color-success)]"
                : "border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-hover)]",
            ].join(" ")}
            aria-label="Copy to clipboard"
          >
            {copied ? <Icon.Check className="w-3 h-3" /> : <Icon.Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={download}
            className="cursor-pointer inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-mono border border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-hover)] transition-colors duration-150"
            aria-label="Download as .txt"
          >
            <Icon.Download className="w-3 h-3" />
            .txt
          </button>
        </div>
      </div>
      {open && (
        <div className="max-h-80 overflow-y-auto bg-[var(--color-bg)] px-4 py-3 border-t border-[var(--color-border)] fade-in">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-text-2)] leading-relaxed">{text}</pre>
        </div>
      )}
    </div>
  );
}

function Section({
  id,
  label,
  children,
  count,
}: {
  id: string;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-16">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-2)]">
          {label}
        </h2>
        {typeof count === "number" && (
          <span className="font-mono text-[10px] text-[var(--color-text-4)]">
            {count} {count === 1 ? "doc" : "docs"}
          </span>
        )}
        <div className="bg-[var(--color-border)] h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunPage() {
  const params = useParams();
  const runId = typeof params.id === "string" ? parseInt(params.id, 10) : null;
  const run = useRunPolling(runId);
  const scrolledRef = useRef(false);
  const [resuming, setResuming] = useState(false);

  // Auto-scroll to last completed stage on initial load
  useEffect(() => {
    if (!run || scrolledRef.current) return;
    if (run.status === "pending") return;
    scrolledRef.current = true;

    const lastStage = getLastCompletedStage(run);
    const targetId: Record<string, string> = {
      "stage3-images": "stage-3-section",
      "stage3-prompts": "stage-3-section",
      stage2: "stage-2-section",
      stage1: "stage-1-section",
      scrape: "scrape-section",
    };
    if (targetId[lastStage]) {
      setTimeout(() => {
        document
          .getElementById(targetId[lastStage])
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  async function handleResume() {
    if (!runId || resuming) return;
    setResuming(true);
    try {
      await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      // Give the server a moment to update status before polling refreshes
      setTimeout(() => setResuming(false), 1200);
    } catch {
      setResuming(false);
    }
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
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!run) {
    return (
      <main className="min-h-[calc(100vh-3rem)]">
        <div className="max-w-4xl mx-auto px-5 pt-12">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 fade-in">
            <div className="flex items-center gap-2.5 text-[var(--color-text-3)]">
              <Icon.Loader className="w-4 h-4" />
              <span className="text-[13px]">Loading run&hellip;</span>
            </div>
            <div className="space-y-2 mt-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-3 rounded shimmer bg-[var(--color-surface-2)]" />
              ))}
            </div>
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
  const elapsed = elapsedTime(run.timestamps.startedAt, run.timestamps.completedAt);

  // Count Stage 1 docs we have
  const stage1Docs = [
    outputs.research, outputs.chiefMid, outputs.researchRevised, outputs.avatar,
    outputs.avatarRevised, outputs.offerBrief, outputs.offerBriefRevised,
    outputs.necessaryBeliefs, outputs.necessaryBeliefsRevised, outputs.chiefFinal,
  ].filter(Boolean).length;

  return (
    <main className="min-h-[calc(100vh-3rem)]">
      <div className="max-w-4xl mx-auto px-5 pt-6 pb-24 space-y-6">

        {/* Breadcrumb + header */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-3)]">
            <Link href="/history" className="hover:text-[var(--color-text)] transition-colors inline-flex items-center gap-1">
              <Icon.ArrowLeft className="w-3.5 h-3.5" />
              History
            </Link>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 mb-1">
                <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)] truncate">
                  {displayName}
                </h1>
                <span className="font-mono text-[12px] text-[var(--color-text-4)]">#{runId}</span>
              </div>
              <a
                href={run.meta.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors max-w-full truncate"
              >
                <span className="truncate">{run.meta.productUrl}</span>
                <Icon.ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <StatusDot status={run.status} />
                <span className="text-[12px] text-[var(--color-text)]">{statusLabel(run.status)}</span>
              </div>
              {elapsed && (
                <span className="font-mono text-[11px] text-[var(--color-text-4)]">{elapsed}</span>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <PipelineProgress run={run} />

        {/* Resume banner */}
        {showResumeBanner && (
          <div className="rounded-xl border border-[color:rgb(138_101_48_/_0.30)] bg-[color:rgb(138_101_48_/_0.05)] px-4 py-3.5 fade-in">
            <div className="flex items-start gap-2.5">
              <Icon.Alert className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[var(--color-text)] font-medium">
                  {isFailed ? "Run failed" : "Run appears stuck"}
                </p>
                {run.currentStep && (
                  <p className="text-[11px] text-[var(--color-text-3)] font-mono mt-0.5">
                    at: {run.currentStep}
                  </p>
                )}
                {run.error && (
                  <p className="text-[12px] text-[var(--color-text-2)] mt-1.5 leading-relaxed">
                    {run.error}
                  </p>
                )}
                <button
                  onClick={handleResume}
                  disabled={resuming}
                  className="cursor-pointer mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] disabled:opacity-60 text-white text-[12px] font-medium transition-colors duration-150"
                >
                  {resuming ? (
                    <>
                      <Icon.Loader className="w-3.5 h-3.5" />
                      Resuming&hellip;
                    </>
                  ) : (
                    <>
                      <Icon.Play className="w-3.5 h-3.5" />
                      Resume pipeline
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scraped images */}
        {run.images.scrapedUrls.length > 0 && (
          <Section id="scrape-section" label="Scrape" count={run.images.scrapedUrls.length}>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {run.images.scrapedUrls.slice(0, 10).map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-md overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-border-hover)] transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt={`Product ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Stage 1 outputs */}
        {(outputs.research || run.status === "stage1" || run.status === "scraping") && (
          <Section id="stage-1-section" label="Stage 1 — Research" count={stage1Docs > 0 ? stage1Docs : undefined}>
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
                <div className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center bg-[var(--color-surface)]/40">
                  <Icon.Loader className="w-4 h-4 text-[var(--color-text-3)] mx-auto mb-2" />
                  <p className="text-[12px] text-[var(--color-text-3)]">
                    {run.status === "scraping" ? "Scraping product page…" : "Waiting for Stage 1…"}
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Stage 2 output */}
        {(outputs.stage2Output || run.status === "stage2") && (
          <Section id="stage-2-section" label="Stage 2 — German Copy">
            {outputs.stage2Output ? (
              <OutputBlock label="German Copy Kit" text={outputs.stage2Output} filename="STAGE2_GERMAN_COPY.txt" />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center bg-[var(--color-surface)]/40">
                <Icon.Loader className="w-4 h-4 text-[var(--color-text-3)] mx-auto mb-2" />
                <p className="text-[12px] text-[var(--color-text-3)]">Generating German copy…</p>
              </div>
            )}
          </Section>
        )}

        {/* Stage 3 gate */}
        {(run.status === "awaiting_user" || run.status === "awaiting_qc" || run.status === "completed") && (
          <Section id="stage-3-section" label="Stage 3 — Images">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
              {run.status === "awaiting_user" ? (
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center w-8 h-8 rounded-md bg-[color:rgb(138_101_48_/_0.08)] border border-[color:rgb(138_101_48_/_0.25)] flex-shrink-0">
                    <Icon.Image className="w-4 h-4 text-[var(--color-warn)]" />
                  </span>
                  <div className="flex-1">
                    <p className="text-[13px] text-[var(--color-text)] font-medium mb-1">
                      Ready for Stage 3
                    </p>
                    <p className="text-[12px] text-[var(--color-text-2)] leading-relaxed mb-3">
                      Approve product images and (optionally) add reference photos, then launch image generation.
                    </p>
                    <Link
                      href={`/stage3?runId=${runId}`}
                      className="cursor-pointer inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] text-white text-[12px] font-medium transition-colors duration-150"
                    >
                      Open Stage 3
                      <Icon.ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ) : run.status === "awaiting_qc" ? (
                <div className="flex items-center gap-3 text-[var(--color-text-2)]">
                  <Icon.Loader className="w-4 h-4 text-[var(--color-warn)]" />
                  <span className="text-[12px]">Awaiting prompt review &amp; QC&hellip;</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Icon.Check className="w-4 h-4 text-[var(--color-success)]" />
                  <span className="text-[12px] text-[var(--color-success)]">
                    Stage 3 complete. View images on the Stage 3 page.
                  </span>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Sticky download bar */}
        {hasAnyOutput && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleDownloadAll}
              className="cursor-pointer inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-hover)] text-[var(--color-text)] text-[12px] font-medium transition-colors duration-150"
            >
              <Icon.Download className="w-3.5 h-3.5" />
              Download all docs (.zip)
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
