"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRunPolling, type RunStatus } from "@/hooks/useRunPolling";
import { Icon } from "@/components/ui/Icon";
import AIRegenerate from "@/components/AIRegenerate";
import FeedbackButtons from "@/components/FeedbackButtons";
import FeedbackAppliedChip from "@/components/FeedbackAppliedChip";
import Stage3HeroFlow from "@/components/Stage3HeroFlow";
import EditableOutput from "@/components/EditableOutput";
import JSZip from "jszip";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Stage = "stage1" | "stage2" | "stage3";
type StageState = "pending" | "running" | "complete" | "error" | "waiting";

function getStageState(run: RunStatus, stage: Stage): StageState {
  const isFailed = run.status === "failed";
  const failedAt: Stage | null =
    !isFailed
      ? null
      : run.outputs.stage2Output
        ? "stage3"
        : run.outputs.research
          ? "stage2"
          : "stage1";

  if (failedAt === stage) return "error";

  switch (stage) {
    case "stage1":
      if (run.outputs.onePager) return "complete";
      if (run.status === "stage1" || run.status === "scraping") return "running";
      if (run.outputs.research) return "running";
      return "pending";
    case "stage2":
      if (run.outputs.stage2Output) return "complete";
      if (run.status === "stage2") return "running";
      // Paused at the new Stage 1 → Stage 2 QC gate: Stage 2 hasn't started yet.
      if (run.status === "awaiting_stage2_approval") return "waiting";
      return "pending";
    case "stage3":
      if (run.status === "completed") return "complete";
      if (run.status === "awaiting_user") return "waiting";
      if (run.status === "awaiting_qc") return "running";
      return "pending";
  }
}

type LastStage = "none" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

function getLastCompletedStage(run: RunStatus): LastStage {
  if (run.outputs.stage2Output && run.status === "completed") return "stage3-images";
  if (run.status === "awaiting_qc") return "stage3-prompts";
  if (run.outputs.stage2Output) return "stage2";
  if (run.outputs.onePager) return "stage1";
  return "none";
}

function isStuck(run: RunStatus): boolean {
  if (!run.timestamps.lastUpdatedAt) return false;
  const ageMs = Date.now() - new Date(run.timestamps.lastUpdatedAt).getTime();
  return (
    ageMs > 10 * 60 * 1000 &&
    !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status)
  );
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Starting…",
    scraping: "Stage 1 — Research",
    stage1: "Stage 1 — Research",
    awaiting_stage2_approval: "Awaiting your review",
    stage2: "Stage 2 — Copy",
    awaiting_user: "Awaiting review",
    awaiting_qc: "Awaiting QC",
    generating_hero: "Stage 3 — Generating hero",
    awaiting_hero_qc: "Stage 3 — Review hero",
    generating_remaining: "Stage 3 — Writing prompts",
    completed: "Complete",
    failed: "Failed",
    cancelled: "Cancelled",
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

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-green-bg)] text-[var(--color-green)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />Complete
    </span>
  );
  if (status === "failed") return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-red-bg)] text-[var(--color-red)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />Failed
    </span>
  );
  if (status === "cancelled") return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-gray-bg)] text-[var(--color-gray)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />Cancelled
    </span>
  );
  if (status === "awaiting_user" || status === "awaiting_qc" || status === "awaiting_stage2_approval" || status === "awaiting_hero_qc") return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{statusLabel(status)}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-accent-weak)] text-[var(--color-accent)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 pulse-dot" />{statusLabel(status)}
    </span>
  );
}

function PipelineProgress({ run }: { run: RunStatus }) {
  const stages: { key: Stage; label: string }[] = [
    { key: "stage1", label: "Research" },
    { key: "stage2", label: "Copy" },
    { key: "stage3", label: "Images" },
  ];

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-5 py-4">
      <div className="flex items-center gap-2">
        {stages.map((s, i) => {
          const state = getStageState(run, s.key);

          const circleCls =
            state === "complete"
              ? "w-8 h-8 rounded-full bg-[var(--color-green)] text-white grid place-items-center font-bold text-sm border-2 border-[var(--color-green)]"
              : state === "running"
                ? "w-8 h-8 rounded-full bg-[var(--color-primary)] text-white grid place-items-center font-bold text-sm border-2 border-[var(--color-primary)]"
                : state === "error"
                  ? "w-8 h-8 rounded-full bg-[var(--color-red)] text-white grid place-items-center font-bold text-sm border-2 border-[var(--color-red)]"
                  : state === "waiting"
                    ? "w-8 h-8 rounded-full bg-[var(--color-amber)] text-white grid place-items-center font-bold text-sm border-2 border-[var(--color-amber)]"
                    : "w-8 h-8 rounded-full border-2 border-[var(--color-border-strong)] text-[var(--color-text-3)] grid place-items-center font-bold text-sm";

          const labelCls =
            state === "pending"
              ? "text-[var(--color-text-3)]"
              : state === "running"
                ? "text-[var(--color-accent)]"
                : state === "error"
                  ? "text-[var(--color-error)]"
                  : state === "waiting"
                    ? "text-[var(--color-warn)]"
                    : "text-[var(--color-text)]";

          const connectorCls =
            state === "complete"
              ? "flex-1 h-0.5 bg-[var(--color-green)] mx-3"
              : "flex-1 h-0.5 bg-[var(--color-border-strong)] mx-3";

          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0 last:flex-initial">
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <span className={circleCls} aria-label={`${s.label}: ${state}`}>
                  {state === "complete" ? (
                    <Icon.Check className="w-4 h-4" strokeWidth={3} />
                  ) : state === "running" ? (
                    <Icon.Loader className="w-3.5 h-3.5" />
                  ) : state === "error" ? (
                    <Icon.X className="w-4 h-4" strokeWidth={3} />
                  ) : state === "waiting" ? (
                    <span className="text-sm">!</span>
                  ) : (
                    <span className="text-sm">{i + 1}</span>
                  )}
                </span>
                <span className={`text-[11px] font-[550] ${labelCls} whitespace-nowrap`}>{s.label}</span>
              </div>
              {i < stages.length - 1 && (
                <div className={connectorCls} style={{ marginBottom: "18px" }} />
              )}
            </div>
          );
        })}
      </div>

      {run.currentStep && !["completed", "failed", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval"].includes(run.status) && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
          <Icon.Loader className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-2)] truncate">{run.currentStep}</span>
        </div>
      )}
    </div>
  );
}


// Minimal markdown renderer for the Stage 1 one-pager.
function OnePagerMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: { type: "ol" | "ul"; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const ListTag = listBuffer.type;
    const cls =
      listBuffer.type === "ol"
        ? "list-decimal pl-5 space-y-1.5"
        : "list-disc pl-5 space-y-1.5";
    blocks.push(
      <ListTag key={`list-${blocks.length}`} className={cls}>
        {listBuffer.items.map((it, i) => (
          <li key={i} className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{it}</li>
        ))}
      </ListTag>
    );
    listBuffer = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }
    const h1 = line.match(/^# +(.+)$/);
    const h2 = line.match(/^## +(.+)$/);
    const ol = line.match(/^\d+\.\s+(.+)$/);
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (h1) {
      flushList();
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-xl font-bold tracking-tight text-[var(--color-text)] mb-1">
          {h1[1]}
        </h1>
      );
    } else if (h2) {
      flushList();
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-text-3)] mt-5 mb-2">
          {h2[1]}
        </h2>
      );
    } else if (ol) {
      if (!listBuffer || listBuffer.type !== "ol") { flushList(); listBuffer = { type: "ol", items: [] }; }
      listBuffer.items.push(ol[1]);
    } else if (ul) {
      if (!listBuffer || listBuffer.type !== "ul") { flushList(); listBuffer = { type: "ul", items: [] }; }
      listBuffer.items.push(ul[1]);
    } else {
      flushList();
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{line}</p>
      );
    }
  }
  flushList();
  return <div className="space-y-1">{blocks}</div>;
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
        <h2 className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-text-2)]">
          {label}
        </h2>
        {typeof count === "number" && (
          <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)]">
            {count} {count === 1 ? "doc" : "docs"}
          </span>
        )}
        <div className="bg-[var(--color-border)] h-px flex-1" />
      </div>
      {children}
    </section>
  );
}

// ── Failure recovery helpers ──────────────────────────────────────────────────

type FailableStage = "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

const STAGE_SECTION_ID: Record<FailableStage, string> = {
  stage1: "stage-1-section",
  stage2: "stage-2-section",
  "stage3-prompts": "stage-3-section",
  "stage3-images": "stage-3-section",
};

const STAGE_DISPLAY_NAME: Record<FailableStage, string> = {
  stage1: "Stage 1",
  stage2: "Stage 2",
  "stage3-prompts": "Stage 3 Prompts",
  "stage3-images": "Stage 3 Images",
};

function getFailedStage(run: RunStatus): FailableStage {
  if (!run.outputs.onePager) return "stage1";
  if (!run.outputs.stage2Output) return "stage2";
  // Stage 3 outputs aren't exposed via the polling endpoint, so we can't
  // distinguish stage3-prompts vs stage3-images here. Fall back to prompts —
  // restarting prompts also clears any partial image generation.
  return "stage3-prompts";
}

function getPreviousStage(stage: FailableStage): FailableStage | null {
  if (stage === "stage2") return "stage1";
  if (stage === "stage3-prompts") return "stage2";
  if (stage === "stage3-images") return "stage3-prompts";
  return null;
}

function scrollToStage(stage: FailableStage | null) {
  if (!stage) return;
  document.getElementById(STAGE_SECTION_ID[stage])?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

// Short label for the Restart button (STAGE_DISPLAY_NAME is verbose for stage 3).
const RESTART_LABEL: Record<FailableStage, string> = {
  stage1: "Stage 1",
  stage2: "Stage 2",
  "stage3-prompts": "Stage 3",
  "stage3-images": "Stage 3 Images",
};

// Per-stage "go back / restart" controls, shown under every stage section.
function StageActions({
  stage,
  previousStage,
  onRestart,
  restarting,
}: {
  stage: FailableStage;
  previousStage: FailableStage | null;
  onRestart: (s: FailableStage) => void;
  restarting: boolean;
}) {
  const btn =
    "cursor-pointer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-[550] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-2)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-60 whitespace-nowrap";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {previousStage && (
        <button onClick={() => scrollToStage(previousStage)} className={btn}>
          <Icon.ArrowLeft className="w-3.5 h-3.5" />
          Back to {STAGE_DISPLAY_NAME[previousStage]}
        </button>
      )}
      <button onClick={() => onRestart(stage)} disabled={restarting} className={btn}>
        {restarting ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />}
        Restart {RESTART_LABEL[stage]}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunPage() {
  const params = useParams();
  const runId = typeof params.id === "string" ? parseInt(params.id, 10) : null;
  const run = useRunPolling(runId);
  const scrolledRef = useRef(false);
  const autoResumedRef = useRef(false);
  const [resuming, setResuming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [killing, setKilling] = useState(false);

  async function handleKill() {
    if (!runId || killing) return;
    if (!window.confirm("Kill this run? It stops at the next stage boundary. You can Resume it later.")) return;
    setKilling(true);
    try {
      await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
    } catch { /* ignore */ }
    finally { setTimeout(() => setKilling(false), 1200); }
  }
  const [startingStage2, setStartingStage2] = useState(false);

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
      setTimeout(() => setResuming(false), 1200);
    } catch {
      setResuming(false);
    }
  }

  // Auto-resume a stuck run. A run is "stuck" when it's still in an active
  // status but its timestamp has been cold for 10+ min — almost always the
  // fire-and-forget pipeline being killed mid-run (e.g. dev server restart).
  // resumePipeline + granular Stage 1 resume picks up from the last completed
  // sub-step, so no work is lost. Fires once per stuck episode and re-arms
  // once the run is healthy again, so repeated deaths still self-heal without
  // spamming (a stuck run is, by definition, ≥10 min between attempts).
  useEffect(() => {
    if (!run || !runId) return;
    if (isStuck(run)) {
      if (!autoResumedRef.current) {
        autoResumedRef.current = true;
        handleResume();
      }
    } else {
      autoResumedRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, runId]);

  async function handleStartStage2() {
    if (!runId || startingStage2) return;
    setStartingStage2(true);
    try {
      const res = await fetch(`/api/runs/${runId}/start-stage2`, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        alert(`Failed to start Stage 2: ${data.error ?? "unknown error"}`);
      }
    } catch (err) {
      alert(`Failed to start Stage 2: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTimeout(() => setStartingStage2(false), 1200);
    }
  }

  async function handleRestartStage(stage: FailableStage) {
    if (!runId || restarting) return;
    const isStage3 = stage === "stage3-prompts" || stage === "stage3-images";
    if (
      !window.confirm(
        isStage3
          ? "Restart Stage 3 from scratch? This deletes the hero, all 8 images, and the section placement, and returns to the Stage 3 start."
          : `Restart ${RESTART_LABEL[stage]}? This clears that stage's output and re-runs it.`,
      )
    ) {
      return;
    }
    setRestarting(true);
    try {
      const res = await fetch(`/api/runs/${runId}/restart-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`Restart failed: ${data.error ?? "unknown error"}`);
        setRestarting(false);
        return;
      }
      // Stage 3 lives in a self-contained component with its own fetched state;
      // reload so it picks up the wiped columns and shows the entry screen.
      window.location.reload();
    } catch (err) {
      alert(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
      setRestarting(false);
    }
  }

  async function handleDownloadAll() {
    if (!run) return;
    const slug = run.meta.brandName ?? run.meta.productName ?? `run_${runId}`;
    const zip = new JSZip();
    const { outputs } = run;
    const files: [string | null, string][] = [
      [outputs.onePagerEdited ?? outputs.onePager, `${slug}_STAGE1_ONE_PAGER.md`],
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
      <main className="px-7 py-7 max-w-[1080px] mx-auto">
        <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-8 fade-in">
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
      </main>
    );
  }

  const { outputs } = run;
  const hasAnyOutput = Object.values(outputs).some(Boolean);
  const isFailed = run.status === "failed";
  const isCancelled = run.status === "cancelled";
  const isStuckRun = isStuck(run);
  // Non-terminal = something is (or should be) running → can be killed.
  const isTerminal = ["completed", "failed", "cancelled"].includes(run.status);
  const showResumeBanner = isFailed || isCancelled || isStuckRun;
  const displayName = run.meta.brandName ?? run.meta.productName ?? `Run #${runId}`;
  const elapsed = elapsedTime(run.timestamps.startedAt, run.timestamps.completedAt);

  const hasOnePager = Boolean(outputs.onePager);

  return (
    <main className="px-7 py-7 max-w-[1080px] mx-auto">
      <div className="space-y-6">

        {/* Breadcrumb + header */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-3)]">
            <Link href="/history" className="hover:text-[var(--color-text)] transition-colors inline-flex items-center gap-1">
              <Icon.ArrowLeft className="w-3.5 h-3.5" />
              Runs
            </Link>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)] truncate">
                  {displayName}
                </h1>
                <span className="font-[var(--font-ibm-plex-mono)] text-[12px] text-[var(--color-text-4)]">#{runId}</span>
              </div>
              {run.meta.productUrl ? (
                <a
                  href={run.meta.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-accent)] transition-colors max-w-full truncate"
                >
                  <span className="truncate">{run.meta.productUrl}</span>
                  <Icon.ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              ) : (
                <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)]">
                  Description-only run
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <StatusBadge status={run.status} />
              {elapsed && (
                <span className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-4)]">{elapsed}</span>
              )}
              {!isTerminal && (
                <button
                  onClick={handleKill}
                  disabled={killing}
                  title="Stop this run at the next stage boundary"
                  className="cursor-pointer inline-flex items-center gap-[6px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-red)]/50 bg-[var(--color-red-bg)] text-[var(--color-red)] transition-all hover:brightness-95 whitespace-nowrap disabled:opacity-50"
                >
                  {killing ? "Killing…" : "■ Kill run"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <PipelineProgress run={run} />

        {/* Submitted inputs (description + source images) */}
        {(run.meta.productDescription || run.meta.uploadedSourceImages.length > 0) && (
          <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-5 py-4 space-y-3">
            {run.meta.productDescription && (
              <div>
                <p className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-text-3)] mb-1.5">
                  Description
                </p>
                <p className="text-[13px] text-[var(--color-text-2)] leading-relaxed whitespace-pre-wrap">
                  {run.meta.productDescription}
                </p>
              </div>
            )}
            {run.meta.uploadedSourceImages.length > 0 && (
              <div>
                <p className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-text-3)] mb-1.5">
                  Source images · {run.meta.uploadedSourceImages.length}
                </p>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                  {run.meta.uploadedSourceImages.map((url, i) => (
                    <a
                      key={url + i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aspect-square rounded-[9px] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)] transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Source ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Resume banner */}
        {showResumeBanner && (
          <div className="border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] border-l-4 border-l-[var(--color-amber)] rounded-[11px] px-[18px] py-4 flex items-center gap-4 flex-wrap fade-in">
            <Icon.Alert className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-[var(--color-text)] font-[600]">
                {isFailed ? "Run failed" : isCancelled ? "Run cancelled" : "Run appears stuck"}
              </p>
              {run.currentStep && (
                <p className="text-[11px] text-[var(--color-text-3)] font-[var(--font-ibm-plex-mono)] mt-0.5">
                  at: {run.currentStep}
                </p>
              )}
              {run.error && (
                <p className="text-[12px] text-[var(--color-text-2)] mt-1.5 leading-relaxed">
                  {run.error}
                </p>
              )}
            </div>
            <button
              onClick={handleResume}
              disabled={resuming}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-60"
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
        )}

        {/* Go-back / restart row — only when the run actually failed (not just stuck) */}
        {isFailed && (() => {
          const failedStage = getFailedStage(run);
          const previousStage = getPreviousStage(failedStage);
          return (
            <div className="flex gap-3 flex-wrap fade-in">
              {previousStage && (
                <button
                  onClick={() => scrollToStage(previousStage)}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
                >
                  <Icon.ArrowLeft className="w-3.5 h-3.5" />
                  Go back to {STAGE_DISPLAY_NAME[previousStage]}
                </button>
              )}
              <button
                onClick={() => handleRestartStage(failedStage)}
                disabled={restarting}
                className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-accent)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-60"
              >
                {restarting ? (
                  <>
                    <Icon.Loader className="w-3.5 h-3.5" />
                    Restarting&hellip;
                  </>
                ) : (
                  <>
                    <Icon.Refresh className="w-3.5 h-3.5" />
                    Restart {STAGE_DISPLAY_NAME[failedStage]}
                  </>
                )}
              </button>
            </div>
          );
        })()}

        {/* Competitor scrape errors */}
        {run.scrapeErrors && run.scrapeErrors.length > 0 && (
          <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-amber-bg)] px-4 py-3 fade-in">
            <div className="flex items-start gap-2.5">
              <Icon.Alert className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[var(--color-text)] font-[600] mb-1">
                  {run.scrapeErrors.length} competitor URL{run.scrapeErrors.length === 1 ? "" : "s"} couldn&rsquo;t be scraped
                </p>
                <ul className="space-y-0.5">
                  {run.scrapeErrors.map((e, i) => (
                    <li key={i} className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-3)] truncate">
                      <span className="text-[var(--color-text-2)]">{e.url}</span>
                      <span className="mx-1.5 text-[var(--color-text-4)]">·</span>
                      {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Stage 1 — single one-pager */}
        {(hasOnePager || run.status === "stage1" || run.status === "scraping") && (
          <Section id="stage-1-section" label="Stage 1 — Research summary">
            {hasOnePager ? (
              <>
                <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-6 py-5">
                  <OnePagerMarkdown text={outputs.onePagerEdited ?? outputs.onePager ?? ""} />
                </div>
                {runId !== null && (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                      <StageActions
                        stage="stage1"
                        previousStage={null}
                        onRestart={handleRestartStage}
                        restarting={restarting}
                      />
                      <AIRegenerate
                        runId={runId}
                        stage="stage1"
                        onRegenerated={() => window.location.reload()}
                        initialFeedback={run.feedback?.stage1Note ?? null}
                      />
                    </div>
                    <div className="flex items-start justify-between gap-3 flex-wrap pt-1">
                      <FeedbackAppliedChip stage={1} />
                      <FeedbackButtons
                        runId={runId}
                        stage="stage1"
                        initialVote={run.feedback?.stage1 ?? null}
                        initialNote={run.feedback?.stage1Note ?? null}
                      />
                    </div>
                  </>
                )}

                {/* QC gate — paused between Stage 1 and Stage 2 */}
                {run.status === "awaiting_stage2_approval" && (
                  <div className="mt-5 border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] border-l-4 border-l-[var(--color-amber)] rounded-[11px] px-[18px] py-4 flex items-center gap-4 flex-wrap fade-in">
                    <Icon.Alert className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--color-text)] font-[600]">
                        Review the research summary above
                      </p>
                      <p className="text-[12px] text-[var(--color-text-2)] mt-0.5 leading-relaxed">
                        Edit it if needed, then run Stage 2 to generate the German copy.
                      </p>
                    </div>
                    <button
                      onClick={handleStartStage2}
                      disabled={startingStage2}
                      className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-60"
                    >
                      {startingStage2 ? (
                        <>
                          <Icon.Loader className="w-3.5 h-3.5" />
                          Starting Stage 2&hellip;
                        </>
                      ) : (
                        <>
                          Looks good — run Stage 2
                          <Icon.ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="border border-dashed border-[var(--color-border)] rounded-[11px] px-4 py-10 text-center bg-[var(--color-surface)]">
                <Icon.Loader className="w-4 h-4 text-[var(--color-text-3)] mx-auto mb-2" />
                <p className="text-[12px] text-[var(--color-text-3)]">
                  {run.currentStep ?? "Researching the product…"}
                </p>
              </div>
            )}
          </Section>
        )}

        {/* Stage 2 output */}
        {(outputs.stage2Output || run.status === "stage2") && (
          <Section id="stage-2-section" label="Stage 2 — German Copy">
            {outputs.stage2Output ? (
              <>
                <EditableOutput
                  runId={Number(runId)}
                  field="stage2_copy"
                  stage="stage2"
                  originalValue={outputs.stage2Output}
                  editedValue={outputs.stage2OutputEdited}
                  editedAt={outputs.stage2EditedAt}
                  label="German Copy Kit"
                  monospace={false}
                  downloadFilename="STAGE2_GERMAN_COPY.txt"
                />
                {runId !== null && (
                  <>
                    <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
                      <AIRegenerate
                        runId={runId}
                        stage="stage2"
                        onRegenerated={() => window.location.reload()}
                        initialFeedback={run.feedback?.stage2Note ?? null}
                      />
                      <div className="flex items-start gap-3">
                        <FeedbackAppliedChip stage={2} />
                        <FeedbackButtons
                          runId={runId}
                          stage="stage2"
                          initialVote={run.feedback?.stage2 ?? null}
                          initialNote={run.feedback?.stage2Note ?? null}
                        />
                      </div>
                    </div>
                    <StageActions
                      stage="stage2"
                      previousStage="stage1"
                      onRestart={handleRestartStage}
                      restarting={restarting}
                    />
                  </>
                )}
              </>
            ) : (
              <div className="border border-dashed border-[var(--color-border)] rounded-[11px] px-4 py-8 text-center bg-[var(--color-surface)]">
                <Icon.Loader className="w-4 h-4 text-[var(--color-text-3)] mx-auto mb-2" />
                <p className="text-[12px] text-[var(--color-text-3)]">Generating German copy…</p>
              </div>
            )}
          </Section>
        )}

        {/* Stage 3 — hero-first two-phase flow. Shows once Stage 2 has output,
            or any time a hero-flow status is active. The component drives all
            of its own states (entry → hero QC → prompt QC → grid) off the run
            status it polls directly. */}
        {(Boolean(outputs.stage2Output) ||
          ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status)) && (
          <Section id="stage-3-section" label="Stage 3 — Images">
            <Stage3HeroFlow runId={Number(runId)} stage2Ready={Boolean(outputs.stage2Output)} />
            <StageActions
              stage="stage3-prompts"
              previousStage="stage2"
              onRestart={handleRestartStage}
              restarting={restarting}
            />
          </Section>
        )}

        {/* Download all */}
        {hasAnyOutput && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleDownloadAll}
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-[15px] py-[9px] text-[13.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap"
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
