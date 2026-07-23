"use client";

// v2 run page (run2.jsx): header with thumb, live log while running, stepper +
// accordion stage cards with progressive disclosure, sticky bottom action bar.
// All real wiring preserved: polling, kill, resume, restart, Stage 2 approval,
// editing, AI regenerate, feedback, Stage 3 hero flow, product code, downloads.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRunPolling, type RunStatus } from "@/hooks/useRunPolling";
import { Icon } from "@/components/ui/Icon";
import { MeshThumb, StatusBadge, elapsedTime, statusLabel, truncateUrl } from "@/components/ui/run-ui";
import { useToast } from "@/components/Toasts";
import AIRegenerate from "@/components/AIRegenerate";
import FeedbackButtons from "@/components/FeedbackButtons";
import FeedbackAppliedChip from "@/components/FeedbackAppliedChip";
import Stage3HeroFlow from "@/components/Stage3HeroFlow";
import EditableOutput from "@/components/EditableOutput";
import Stage2Shopify from "@/components/Stage2Shopify";
import type { Stage2Json } from "@/lib/stage2/shape";
import RunProductCode from "@/components/RunProductCode";
import PromptUsed from "@/components/PromptUsed";
import JSZip from "jszip";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ── Stage state ───────────────────────────────────────────────────────────────

type StageKey = "stage1" | "stage2" | "stage3";
type StageState = "pending" | "running" | "complete" | "error" | "waiting";

function getStageState(run: RunStatus, stage: StageKey): StageState {
  const isFailed = run.status === "failed";
  const failedAt: StageKey | null = !isFailed ? null
    : run.outputs.stage2Output ? "stage3"
    : run.outputs.onePager || run.outputs.research ? "stage2"
    : "stage1";
  if (failedAt === stage) return "error";

  switch (stage) {
    case "stage1":
      if (run.outputs.onePager) return "complete";
      if (["stage1", "scraping", "pending"].includes(run.status)) return "running";
      if (run.outputs.research) return "running";
      return "pending";
    case "stage2":
      if (run.outputs.stage2Output) return "complete";
      if (run.status === "stage2") return "running";
      if (run.status === "awaiting_stage2_approval") return "waiting";
      return "pending";
    case "stage3":
      if (run.status === "completed") return "complete";
      if (["awaiting_user", "awaiting_qc", "awaiting_hero_qc"].includes(run.status)) return "waiting";
      if (["generating_hero", "generating_remaining"].includes(run.status)) return "running";
      return "pending";
  }
}

function isStuck(run: RunStatus): boolean {
  if (!run.timestamps.lastUpdatedAt) return false;
  const ageMs = Date.now() - new Date(run.timestamps.lastUpdatedAt).getTime();
  return (
    ageMs > 10 * 60 * 1000 &&
    !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status)
  );
}

// ── One-pager markdown ────────────────────────────────────────────────────────

function OnePagerMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: { type: "ol" | "ul"; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const ListTag = listBuffer.type;
    const cls = listBuffer.type === "ol" ? "list-decimal pl-5 space-y-1.5" : "list-disc pl-5 space-y-1.5";
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
      blocks.push(<h1 key={`h1-${blocks.length}`} className="text-[20px] font-bold tracking-tight ff-display text-[var(--color-text)] mb-1">{h1[1]}</h1>);
    } else if (h2) {
      flushList();
      blocks.push(<h2 key={`h2-${blocks.length}`} className="eyebrow block mt-5 mb-2">{h2[1]}</h2>);
    } else if (ol) {
      if (!listBuffer || listBuffer.type !== "ol") { flushList(); listBuffer = { type: "ol", items: [] }; }
      listBuffer.items.push(ol[1]);
    } else if (ul) {
      if (!listBuffer || listBuffer.type !== "ul") { flushList(); listBuffer = { type: "ul", items: [] }; }
      listBuffer.items.push(ul[1]);
    } else {
      flushList();
      blocks.push(<p key={`p-${blocks.length}`} className="text-[13px] text-[var(--color-text-2)] leading-relaxed">{line}</p>);
    }
  }
  flushList();
  return <div className="space-y-1">{blocks}</div>;
}

// ── Live log (console feel during active runs) ────────────────────────────────

type LogLine = { k: string; t: string };

function LiveLog({ run, log }: { run: RunStatus; log: LogLine[] }) {
  const active = !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log.length]);
  if (!active || !log.length) return null;
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden fade-in">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
        <span className="eyebrow text-[var(--color-text-2)]">Live · {statusLabel(run.status)}</span>
      </div>
      <div ref={ref} className="bg-[var(--color-bg)] px-4 py-3 max-h-[150px] overflow-y-auto ff-mono text-[11.5px] leading-[1.8]">
        {log.slice(-8).map((l, i, arr) => {
          const last = i === arr.length - 1;
          return (
            <div key={l.k} className={cx("log-line flex gap-2", last ? "text-[var(--color-text)]" : "text-[var(--color-text-3)]")}>
              <span className="text-[var(--color-accent)] shrink-0">{last ? "›" : "·"}</span>
              <span className={last ? "caret" : ""}>{l.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stage accordion card ──────────────────────────────────────────────────────

const STAGE_DEFS: { key: StageKey; id: string; n: number; title: string; what: string }[] = [
  { key: "stage1", id: "v2-stage-1", n: 1, title: "Research", what: "Product ID, market, avatar, offer one-pager" },
  { key: "stage2", id: "v2-stage-2", n: 2, title: "Copy", what: "Full DTC copy kit from the approved research" },
  { key: "stage3", id: "v2-stage-3", n: 3, title: "Images", what: "Hero shot first, then 8 derivatives" },
];

const stageActionable = (st: StageState) => ["running", "waiting", "error"].includes(st);

function StageAccordion({ def, state, open, onToggle, summary, children, isLast }: {
  def: typeof STAGE_DEFS[number];
  state: StageState;
  open: boolean;
  onToggle: () => void;
  summary: string | null;
  children: React.ReactNode;
  isLast: boolean;
}) {
  const stateIcon = {
    complete: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-green)] text-[var(--color-on-primary)] border-2 border-[var(--color-green)]"><Icon.Check className="w-3.5 h-3.5" strokeWidth={3} /></span>,
    running: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-primary)] text-[var(--color-on-primary)] border-2 border-[var(--color-primary)] ring-pulse"><Icon.Loader className="w-3.5 h-3.5" /></span>,
    waiting: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-amber)] text-white border-2 border-[var(--color-amber)] text-[12px] font-bold">!</span>,
    error: <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--color-red)] text-white border-2 border-[var(--color-red)]"><Icon.X className="w-3.5 h-3.5" strokeWidth={3} /></span>,
    pending: <span className="w-7 h-7 rounded-full grid place-items-center border-2 border-[var(--color-border-strong)] text-[var(--color-text-3)] text-[12px] font-bold bg-[var(--color-surface)]">{def.n}</span>,
  }[state];
  const stateLabel = { complete: "Done", running: "Running…", waiting: "Needs you", error: "Failed", pending: "Waiting" }[state];
  const stateColor = {
    complete: "text-[var(--color-green)]", running: "text-[var(--color-accent-text)]",
    waiting: "text-[var(--color-amber)]", error: "text-[var(--color-red)]", pending: "text-[var(--color-text-4)]",
  }[state];
  const canOpen = state !== "pending";
  return (
    <div id={def.id} className="relative scroll-mt-24">
      {!isLast && <div className="absolute left-[29px] top-[52px] bottom-[-14px] w-0.5 bg-[var(--color-border)]" aria-hidden="true" />}
      <div className={cx("border rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-visible", open ? "border-[var(--color-border-strong)]" : "border-[var(--color-border)]")}>
        <button onClick={() => canOpen && onToggle()} disabled={!canOpen}
          className={cx("w-full flex items-center gap-3.5 px-4 py-3.5 text-left tr rounded-[var(--radius)]", canOpen ? "cursor-pointer hover:bg-[var(--color-surface-2)]" : "cursor-default opacity-70")}>
          {stateIcon}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <p className="text-[14.5px] font-[680] text-[var(--color-text)] whitespace-nowrap">{def.title}</p>
              <span className={cx("text-[11.5px] font-[620] whitespace-nowrap", stateColor)}>{stateLabel}</span>
            </div>
            <p className="text-[12px] text-[var(--color-text-3)] truncate mt-0.5">{summary || def.what}</p>
          </div>
          {canOpen && <Icon.ChevronRight className={cx("w-4 h-4 text-[var(--color-text-3)] transition-transform shrink-0", open && "rotate-90")} />}
        </button>
        {open && <div className="px-4 pb-5 pt-1 border-t border-[var(--color-border)] fade-in"><div className="pt-4 space-y-4">{children}</div></div>}
      </div>
    </div>
  );
}

// ── Start prompt (the input the operator typed to create the run) ─────────────

function StartPrompt({ description, competitorUrls }: { description: string; competitorUrls: string[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] underline decoration-dotted underline-offset-2 tr"
      >
        {open ? "Hide start prompt" : "View start prompt"}
      </button>
      {open && (
        <div className="mt-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <span className="ff-mono text-[10.5px] uppercase tracking-widest text-[var(--color-text-3)]">What you entered to start this run</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(description).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="cursor-pointer text-[10.5px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] tr"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-text-2)] whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{description}</p>
          {competitorUrls.length > 0 && (
            <div className="px-3 pb-2.5 text-[11px] text-[var(--color-text-3)] break-all">Competitor URLs: {competitorUrls.join(", ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stage actions (back / restart) ────────────────────────────────────────────

type RestartStage = "stage1" | "stage2" | "stage3-prompts";

function StageActions({ stage, prevLabel, prevId, onRestart, restarting }: {
  stage: RestartStage;
  prevLabel?: string;
  prevId?: string;
  onRestart: (s: RestartStage) => void;
  restarting: boolean;
}) {
  const btn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap";
  const label = stage === "stage1" ? "Stage 1" : stage === "stage2" ? "Stage 2" : "Stage 3";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {prevId && (
        <button onClick={() => document.getElementById(prevId)?.scrollIntoView({ behavior: "smooth", block: "start" })} className={btn}>
          <Icon.ArrowLeft className="w-3.5 h-3.5" /> Back to {prevLabel}
        </button>
      )}
      <button onClick={() => onRestart(stage)} disabled={restarting} className={btn}>
        {restarting ? <Icon.Loader className="w-3.5 h-3.5" /> : <Icon.Refresh className="w-3.5 h-3.5" />} Restart {label}
      </button>
    </div>
  );
}

// ── Next action (bottom bar content) ──────────────────────────────────────────

type NextAction = {
  tone: "amber" | "red" | "green" | "accent";
  icon?: "review" | "image" | "alert" | "check";
  title: string;
  sub?: string;
  cta?: string;
  running?: boolean;
  onClick?: () => void;
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunPage() {
  const params = useParams();
  const runId = typeof params.id === "string" ? parseInt(params.id, 10) : null;
  const run = useRunPolling(runId);
  const { push } = useToast();
  const autoResumedRef = useRef(false);
  const [resuming, setResuming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [killing, setKilling] = useState(false);
  const [startingStage2, setStartingStage2] = useState(false);
  const [overrides, setOverrides] = useState<Partial<Record<StageKey, boolean>>>({});
  const [stage2View, setStage2View] = useState<"text" | "copy">("text");
  const [zippingImages, setZippingImages] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameOverride, setNameOverride] = useState<string | null>(null);

  // Live log: accumulate status/step transitions from polling.
  const [log, setLog] = useState<LogLine[]>([]);
  const lastStepRef = useRef<string | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    const entries: LogLine[] = [];
    if (run.status !== lastStatusRef.current) {
      lastStatusRef.current = run.status;
      entries.push({ k: Math.random().toString(36).slice(2), t: `→ ${statusLabel(run.status)}` });
    }
    if (run.currentStep && run.currentStep !== lastStepRef.current) {
      lastStepRef.current = run.currentStep;
      entries.push({ k: Math.random().toString(36).slice(2), t: run.currentStep });
    }
    if (entries.length) setLog((prev) => [...prev, ...entries].slice(-40));
  }, [run]);

  // Reset manual accordion overrides when the pipeline state changes.
  useEffect(() => { setOverrides({}); }, [run?.status]);

  async function handleKill() {
    if (!runId || killing) return;
    if (!window.confirm("Kill this run? It stops at the next stage boundary. You can Resume it later.")) return;
    setKilling(true);
    try { await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }); } catch { /* ignore */ }
    finally { setTimeout(() => setKilling(false), 1200); }
  }

  async function handleResume() {
    if (!runId || resuming) return;
    setResuming(true);
    try {
      await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      setTimeout(() => setResuming(false), 1200);
    } catch { setResuming(false); }
  }

  // Auto-resume stuck runs (pipeline killed by a server restart).
  useEffect(() => {
    if (!run || !runId) return;
    if (isStuck(run)) {
      if (!autoResumedRef.current) { autoResumedRef.current = true; handleResume(); }
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
      if (!data.success) push(`Failed to start Stage 2: ${data.error ?? "unknown error"}`);
    } catch (err) {
      push(`Failed to start Stage 2: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setTimeout(() => setStartingStage2(false), 1200); }
  }

  async function handleRestartStage(stage: RestartStage) {
    if (!runId || restarting) return;
    const isStage3 = stage === "stage3-prompts";
    if (!window.confirm(isStage3
      ? "Restart Stage 3 from scratch? This deletes the hero, all 8 images, and the section placement, and returns to the Stage 3 start."
      : `Restart ${stage === "stage1" ? "Stage 1" : "Stage 2"}? This clears that stage's output and re-runs it.`)) return;
    setRestarting(true);
    try {
      const res = await fetch(`/api/runs/${runId}/restart-stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!data.success) { push(`Restart failed: ${data.error ?? "unknown error"}`); setRestarting(false); return; }
      window.location.reload();
    } catch (err) {
      push(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
      setRestarting(false);
    }
  }

  async function saveName() {
    const v = nameDraft.trim();
    setRenaming(false);
    if (!runId || !v || v === displayName) return;
    setNameOverride(v);
    try {
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: v }),
      });
      push("Run renamed", "success");
    } catch { push("Rename failed — try again"); }
  }

  async function handleDownloadDocs() {
    if (!run) return;
    const slug = run.meta.brandName ?? run.meta.productName ?? `run_${runId}`;
    const zip = new JSZip();
    const { outputs } = run;
    const files: [string | null, string][] = [
      [outputs.onePagerEdited ?? outputs.onePager, `${slug}_STAGE1_ONE_PAGER.md`],
      [outputs.research, `${slug}_RESEARCH.txt`],
      [outputs.chiefMid, `${slug}_CHIEF_MID.txt`],
      [outputs.researchRevised, `${slug}_RESEARCH_REVISED.txt`],
      [outputs.avatar, `${slug}_AVATAR.txt`],
      [outputs.avatarRevised, `${slug}_AVATAR_REVISED.txt`],
      [outputs.offerBrief, `${slug}_OFFER_BRIEF.txt`],
      [outputs.offerBriefRevised, `${slug}_OFFER_BRIEF_REVISED.txt`],
      [outputs.necessaryBeliefs, `${slug}_NECESSARY_BELIEFS.txt`],
      [outputs.necessaryBeliefsRevised, `${slug}_NECESSARY_BELIEFS_REVISED.txt`],
      [outputs.chiefFinal, `${slug}_CHIEF_FINAL.txt`],
      [outputs.stage2Output, `${slug}_STAGE2_COPY.txt`],
    ];
    for (const [content, name] of files) if (content) zip.file(name, content);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${slug}_docs.zip` });
    a.click();
    URL.revokeObjectURL(a.href);
    push("Bundled research + copy → docs.zip", "success");
  }

  async function handleDownloadImages() {
    if (!runId || zippingImages) return;
    setZippingImages(true);
    try {
      const data = await fetch(`/api/runs/${runId}`).then((r) => r.json());
      const r = data.run ?? {};
      const targets: Array<{ url: string; name: string }> = [];
      if (r.stage3_hero_image_url) targets.push({ url: r.stage3_hero_image_url, name: "01_hero.png" });
      try {
        const imgs = JSON.parse(r.stage3_remaining_images || "[]");
        if (Array.isArray(imgs)) {
          for (const im of imgs) {
            if (im?.image_url && im.status !== "failed") {
              targets.push({ url: im.image_url, name: `${String(im.index).padStart(2, "0")}_${im.category || "image"}.png` });
            }
          }
        }
      } catch { /* ignore */ }
      if (!targets.length) { push("No generated images on this run yet"); return; }
      let ok = 0;
      // One file per image (not a zip). Sequential with a small gap so the
      // browser doesn't drop the rapid-fire downloads.
      for (const t of targets) {
        try {
          const blob = await fetch(t.url).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); });
          const href = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement("a"), { href, download: t.name });
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(href);
          ok++;
          await new Promise((res) => setTimeout(res, 350));
        } catch (e) { console.error(`download failed for ${t.name}:`, e); }
      }
      if (!ok) { push("Couldn't fetch the images — check your connection"); return; }
      push(ok < targets.length ? `Downloaded ${ok} of ${targets.length} images` : "Downloaded hero + images", "success");
    } finally { setZippingImages(false); }
  }

  // ── Loading skeleton ──
  if (!run) {
    return (
      <div className="px-6 py-8 max-w-[880px] mx-auto">
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface)] p-8 fade-in">
          <div className="flex items-center gap-2.5 text-[var(--color-text-3)]">
            <Icon.Loader className="w-4 h-4" />
            <span className="text-[13px]">Loading run&hellip;</span>
          </div>
          <div className="space-y-2 mt-5">
            {[1, 2, 3].map((i) => <div key={i} className="h-3 rounded shimmer bg-[var(--color-surface-2)]" />)}
          </div>
        </div>
      </div>
    );
  }

  const { outputs } = run;
  let stage2Json: Stage2Json | null = null;
  if (outputs.stage2Json) { try { stage2Json = JSON.parse(outputs.stage2Json); } catch { stage2Json = null; } }
  const isTerminal = ["completed", "failed", "cancelled"].includes(run.status);
  const displayName = nameOverride ?? run.meta.brandName ?? run.meta.productName ?? `Run #${runId}`;
  const elapsed = elapsedTime(run.timestamps.startedAt, run.timestamps.completedAt);

  const states: Record<StageKey, StageState> = {
    stage1: getStageState(run, "stage1"),
    stage2: getStageState(run, "stage2"),
    stage3: getStageState(run, "stage3"),
  };
  // The approval gate after research belongs on Stage 1 — that's what needs review.
  if (run.status === "awaiting_stage2_approval") { states.stage1 = "waiting"; states.stage2 = "pending"; }

  const autoOpen = (key: StageKey) => stageActionable(states[key]) || (run.status === "completed" && key === "stage3");
  const isOpen = (key: StageKey) => overrides[key] !== undefined ? Boolean(overrides[key]) : autoOpen(key);
  const toggle = (key: StageKey) => setOverrides((p) => ({ ...p, [key]: !isOpen(key) }));
  const openStage = (key: StageKey) => {
    setOverrides((p) => ({ ...p, [key]: true }));
    setTimeout(() => document.getElementById("v2-stage-" + key.slice(-1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const summary = (key: StageKey): string | null => {
    if (key === "stage1") {
      if (!outputs.onePager) return null;
      return (run.meta.brandName ? run.meta.brandName + " · " : "") + "research one-pager" + (outputs.onePagerEdited ? " · edited" : "");
    }
    if (key === "stage2") {
      if (!outputs.stage2Output) return null;
      return "Copy kit" + (outputs.stage2OutputEdited ? " · edited" : "");
    }
    if (run.status === "completed") return "hero + 8 images";
    return null;
  };

  const present: Record<StageKey, boolean> = {
    stage1: Boolean(outputs.onePager) || ["stage1", "scraping", "pending"].includes(run.status),
    stage2: Boolean(outputs.stage2Output) || run.status === "stage2" || Boolean(outputs.onePager),
    stage3: Boolean(outputs.stage2Output) ||
      ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status),
  };

  // ── Next action ──
  const nextAction = (): NextAction => {
    const s = run.status;
    if (s === "awaiting_stage2_approval") return { tone: "amber", icon: "review", title: "Research ready for your review", sub: "Edit it if needed, then generate the copy.", cta: startingStage2 ? "Starting…" : "Run Stage 2", onClick: handleStartStage2 };
    if (s === "awaiting_user") return { tone: "amber", icon: "image", title: "Copy approved — ready for images", sub: "Generate a hero shot, then the 8 derivatives.", cta: "Go to Stage 3", onClick: () => openStage("stage3") };
    if (s === "awaiting_hero_qc") return { tone: "amber", icon: "review", title: "Hero shot needs your approval", sub: "It becomes the reference for every other image.", cta: "Review hero", onClick: () => openStage("stage3") };
    if (s === "awaiting_qc") return { tone: "amber", icon: "review", title: "8 prompts ready to review", sub: "Tweak any prompt, then generate the images.", cta: "Review prompts", onClick: () => openStage("stage3") };
    if (s === "failed") return { tone: "red", icon: "alert", title: "Run failed" + (run.currentStep ? ` at ${run.currentStep}` : ""), sub: run.error || "Pick up from the last completed step — nothing is lost.", cta: resuming ? "Resuming…" : "Resume pipeline", onClick: handleResume };
    if (s === "cancelled") return { tone: "amber", icon: "alert", title: "Run cancelled", sub: "Resume to continue where it stopped.", cta: resuming ? "Resuming…" : "Resume", onClick: handleResume };
    if (s === "completed") return { tone: "green", icon: "check", title: "Run complete", sub: "All research, copy, and images are ready." };
    return { tone: "accent", running: true, title: statusLabel(s), sub: run.currentStep || "Working…" };
  };
  const a = nextAction();
  const toneBar = { amber: "var(--color-amber)", red: "var(--color-red)", green: "var(--color-green)", accent: "var(--color-accent)" }[a.tone];
  const hasDocs = Boolean(outputs.onePager || outputs.stage2Output);
  const showPrimary = !a.running && run.status !== "completed";

  return (
    <div className="px-6 py-8 pb-32 max-w-[880px] mx-auto" data-screen-label="Run">
      {/* header */}
      <Link href="/" className="cursor-pointer inline-flex items-center gap-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-4">
        <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="min-w-0 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-[var(--radius)] overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-surface-3)]">
            {run.meta.uploadedSourceImages[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={run.meta.uploadedSourceImages[0]} alt="" className="w-full h-full object-cover" />
              : <MeshThumb id={runId ?? 0} className="w-full h-full" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 group/name">
              {renaming ? (
                <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); } }}
                  className="text-[22px] font-bold tracking-tight ff-display text-[var(--color-text)] bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded-[var(--radius-sm)] px-2 py-0.5 min-w-0 focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
                  aria-label="Run name" />
              ) : (
                <>
                  <h1 className="text-[22px] font-bold tracking-tight ff-display text-[var(--color-text)] truncate">{displayName}</h1>
                  <button onClick={() => { setNameDraft(displayName); setRenaming(true); }} title="Rename run" aria-label="Rename run"
                    className="opacity-0 group-hover/name:opacity-100 focus:opacity-100 text-[var(--color-text-3)] hover:text-[var(--color-text)] tr p-0.5 cursor-pointer shrink-0">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  </button>
                </>
              )}
              <span className="ff-mono text-[11.5px] text-[var(--color-text-4)]">#{runId}</span>
              {runId !== null && <RunProductCode runId={Number(runId)} />}
            </div>
            <p className="text-[12px] text-[var(--color-text-3)] truncate mt-0.5">
              {run.meta.productUrl ? (
                <a href={run.meta.productUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-accent-text)] tr">
                  {truncateUrl(run.meta.productUrl, 56)}
                </a>
              ) : "Description-only run"}
              {elapsed ? ` · ${elapsed}` : ""}
            </p>
          </div>
        </div>
        <StatusBadge status={run.status} stuck={isStuck(run)} />
      </div>

      {/* the original input the operator typed to start this run */}
      {run.meta.productDescription?.trim() && (
        <StartPrompt description={run.meta.productDescription} competitorUrls={run.meta.competitorUrls ?? []} />
      )}

      {/* live log while running */}
      <div className="mb-5"><LiveLog run={run} log={log} /></div>

      {/* stage accordion */}
      <div className="space-y-3.5">
        {STAGE_DEFS.filter((d) => present[d.key]).map((def, i, arr) => (
          <StageAccordion key={def.key} def={def} state={states[def.key]} open={isOpen(def.key)} onToggle={() => toggle(def.key)}
            summary={summary(def.key)} isLast={i === arr.length - 1}>

            {def.key === "stage1" && (
              outputs.onePager ? (
                <>
                  <div className="border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface-2)] px-5 py-4">
                    <OnePagerMarkdown text={outputs.onePagerEdited ?? outputs.onePager ?? ""} />
                  </div>
                  {run.scrapeErrors && run.scrapeErrors.length > 0 && (
                    <div className="rounded-[var(--radius-sm)] bg-[var(--color-amber-bg)] px-3.5 py-2.5">
                      <p className="text-[11.5px] text-[var(--color-text)] font-[600] mb-1">
                        {run.scrapeErrors.length} competitor URL{run.scrapeErrors.length === 1 ? "" : "s"} couldn&rsquo;t be scraped
                      </p>
                      <ul className="space-y-0.5">
                        {run.scrapeErrors.map((e, i) => (
                          <li key={i} className="ff-mono text-[10px] text-[var(--color-text-3)] truncate">
                            <span className="text-[var(--color-text-2)]">{e.url}</span>
                            <span className="mx-1.5 text-[var(--color-text-4)]">·</span>{e.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {run.meta.uploadedSourceImages.length > 0 && (
                    <div>
                      <p className="eyebrow mb-2">Source images · {run.meta.uploadedSourceImages.length}</p>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                        {run.meta.uploadedSourceImages.map((url, i) => (
                          <a key={url + i} href={url} target="_blank" rel="noopener noreferrer"
                            className="aspect-square rounded-[8px] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)] tr">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Source ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {runId !== null && (
                    <>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <StageActions stage="stage1" onRestart={handleRestartStage} restarting={restarting} />
                        <AIRegenerate runId={runId} stage="stage1" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage1Note ?? null} />
                      </div>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <FeedbackAppliedChip stage={1} />
                        <FeedbackButtons runId={runId} stage="stage1" initialVote={run.feedback?.stage1 ?? null} initialNote={run.feedback?.stage1Note ?? null} />
                      </div>
                      <PromptUsed promptsUsed={run.promptsUsed} stage="stage1" />
                    </>
                  )}
                </>
              ) : (
                <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius)] px-4 py-9 text-center bg-[var(--color-surface)] fade-in">
                  <Icon.Loader className="w-4 h-4 text-[var(--color-accent)] mx-auto mb-2.5" />
                  <p className="text-[12.5px] text-[var(--color-text-2)] ff-mono">{run.currentStep ?? "Researching the product…"}</p>
                </div>
              )
            )}

            {def.key === "stage2" && (
              outputs.stage2Output ? (
                <>
                  <div className="flex items-center gap-1 p-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] border border-[var(--color-border)] w-fit">
                    {((stage2Json ? ["text", "copy"] : ["text"]) as Array<"text" | "copy">).map((v) => (
                      <button key={v} onClick={() => setStage2View(v)}
                        className={`px-3 py-1 rounded-[calc(var(--radius-sm)-2px)] text-[12px] font-[620] tr cursor-pointer ${stage2View === v ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]"}`}>
                        {v === "text" ? "Full text" : "Copy"}
                      </button>
                    ))}
                  </div>
                  {stage2View === "copy" && stage2Json ? (
                    <Stage2Shopify json={stage2Json} />
                  ) : (
                  <EditableOutput
                    runId={Number(runId)}
                    field="stage2_copy"
                    stage="stage2"
                    originalValue={outputs.stage2Output}
                    editedValue={outputs.stage2OutputEdited}
                    editedAt={outputs.stage2EditedAt}
                    label="Copy Kit"
                    monospace={false}
                    downloadFilename="STAGE2_COPY.txt"
                  />
                  )}
                  {runId !== null && (
                    <>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <AIRegenerate runId={runId} stage="stage2" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage2Note ?? null} />
                        <div className="flex items-start gap-3">
                          <FeedbackAppliedChip stage={2} />
                          <FeedbackButtons runId={runId} stage="stage2" initialVote={run.feedback?.stage2 ?? null} initialNote={run.feedback?.stage2Note ?? null} />
                        </div>
                      </div>
                      <StageActions stage="stage2" prevLabel="Research" prevId="v2-stage-1" onRestart={handleRestartStage} restarting={restarting} />
                      <PromptUsed promptsUsed={run.promptsUsed} stage="stage2" />
                    </>
                  )}
                </>
              ) : run.status === "stage2" ? (
                <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius)] px-4 py-9 text-center bg-[var(--color-surface)] fade-in">
                  <Icon.Loader className="w-4 h-4 text-[var(--color-accent)] mx-auto mb-2.5" />
                  <p className="text-[12.5px] text-[var(--color-text-2)] ff-mono">Generating copy…</p>
                </div>
              ) : (
                <p className="text-[12.5px] text-[var(--color-text-3)]">Runs automatically after you approve the research.</p>
              )
            )}

            {def.key === "stage3" && (
              <>
                <Stage3HeroFlow runId={Number(runId)} stage2Ready={Boolean(outputs.stage2Output)} />
                <StageActions stage="stage3-prompts" prevLabel="Copy" prevId="v2-stage-2" onRestart={handleRestartStage} restarting={restarting} />
                <PromptUsed promptsUsed={run.promptsUsed} stage="stage3" />
              </>
            )}
          </StageAccordion>
        ))}
      </div>

      {/* sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pointer-events-none">
        <div className="max-w-[880px] mx-auto pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] backdrop-blur-md shadow-[var(--shadow-pop)]"
            style={{ borderColor: `color-mix(in srgb, ${toneBar} 30%, var(--color-border))` }}>
            <span className="grid place-items-center w-8 h-8 rounded-full shrink-0 text-white" style={{ background: toneBar }}>
              {a.running ? <Icon.Loader className="w-4 h-4" />
                : a.icon === "alert" ? <Icon.Alert className="w-4 h-4" />
                : a.icon === "check" ? <Icon.Check className="w-4 h-4" strokeWidth={3} />
                : a.icon === "image" ? <Icon.Image className="w-4 h-4" />
                : <Icon.Spark className="w-4 h-4" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-[650] text-[var(--color-text)] truncate">{a.title}</p>
              {a.sub && <p className="text-[11.5px] text-[var(--color-text-2)] truncate">{a.sub}</p>}
            </div>
            {(hasDocs || run.status === "completed") && (
              <div className="flex items-center gap-2 shrink-0">
                {hasDocs && (
                  <button onClick={handleDownloadDocs}
                    className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap">
                    <Icon.Download className="w-3.5 h-3.5" /> Docs
                  </button>
                )}
                <button onClick={handleDownloadImages} disabled={zippingImages}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap">
                  <Icon.Image className="w-3.5 h-3.5" /> {zippingImages ? "Downloading…" : "Images"}
                </button>
              </div>
            )}
            {a.running ? (
              !isTerminal && (
                <button onClick={handleKill} disabled={killing}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border bg-[var(--color-red-bg)] text-[var(--color-red)] tr hover:brightness-95 disabled:opacity-50 whitespace-nowrap"
                  style={{ borderColor: "color-mix(in srgb, var(--color-red) 50%, transparent)" }}>
                  <Icon.Stop className="w-3 h-3" /> {killing ? "Killing…" : "Kill"}
                </button>
              )
            ) : showPrimary && a.cta && (
              <button onClick={a.onClick} disabled={startingStage2 || resuming}
                className="cursor-pointer shrink-0 inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[9px] text-[13.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 disabled:opacity-60 whitespace-nowrap">
                {a.cta}<Icon.ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
