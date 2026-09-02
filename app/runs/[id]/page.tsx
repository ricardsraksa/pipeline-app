"use client";

// v2 run page (run2.jsx): header with thumb, live log while running, stepper +
// accordion stage cards with progressive disclosure, sticky bottom action bar.
// All real wiring preserved: polling, kill, resume, restart, Stage 3 approval,
// editing, AI regenerate, feedback, Stage 4 hero flow, product code, downloads.

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
import RunCost from "@/components/RunCost";
import SendToDoc from "@/components/SendToDoc";
import ProductGate from "@/components/ProductGate";
import AnglePicker from "@/components/AnglePicker";
import JSZip from "jszip";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ── Stage state ───────────────────────────────────────────────────────────────

// Internal keys are one behind the numbers on screen: product = Stage 1,
// stage1 = Stage 2 (research), stage2 = Stage 3 (copy), stage3 = Stage 4 (images).
type StageKey = "product" | "stage1" | "stage2" | "stage3";
type StageState = "pending" | "running" | "complete" | "error" | "waiting";

const PRODUCT_ACTIVE = ["product", "pending"];
const PRODUCT_DONE = (run: RunStatus) => Boolean(run.product?.approvedAt);

function getStageState(run: RunStatus, stage: StageKey): StageState {
  const isFailed = run.status === "failed";
  const failedAt: StageKey | null = !isFailed ? null
    : run.outputs.stage2Output ? "stage3"
    : run.outputs.onePager || run.outputs.research ? "stage2"
    : PRODUCT_DONE(run) ? "stage1"
    : "product";
  if (failedAt === stage) return "error";

  switch (stage) {
    case "product":
      if (PRODUCT_DONE(run)) return "complete";
      if (run.status === "awaiting_product_approval") return "waiting";
      if (PRODUCT_ACTIVE.includes(run.status)) return "running";
      // Runs from before the product stage existed: nothing to show.
      return run.product?.scrape ? "waiting" : "complete";
    case "stage1":
      if (run.outputs.onePager) return "complete";
      if (["stage1", "scraping"].includes(run.status)) return "running";
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
    !["completed", "failed", "cancelled", "awaiting_user", "awaiting_qc", "awaiting_product_approval", "awaiting_stage2_approval", "awaiting_hero_qc"].includes(run.status)
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

// ── Stage accordion card ──────────────────────────────────────────────────────

const STAGE_DEFS: { key: StageKey; id: string; n: number; title: string; what: string }[] = [
  { key: "product", id: "v2-stage-product", n: 1, title: "Product", what: "Description and photos from the links" },
  { key: "stage1", id: "v2-stage-1", n: 2, title: "Research", what: "Market, avatar, offer, angles" },
  { key: "stage2", id: "v2-stage-2", n: 3, title: "Copy", what: "Copy kit around the chosen angle" },
  { key: "stage3", id: "v2-stage-3", n: 4, title: "Images", what: "Hero, then 8 images" },
];

const stageActionable = (st: StageState) => ["running", "waiting", "error"].includes(st);

// ── Stage actions (back / restart) ────────────────────────────────────────────

type RestartStage = "product" | "stage1" | "stage2" | "stage3-prompts";

function StageActions({ stage, prevLabel, prevId, onRestart, restarting }: {
  stage: RestartStage;
  prevLabel?: string;
  prevId?: string;
  onRestart: (s: RestartStage) => void;
  restarting: boolean;
}) {
  const btn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap";
  const label = stage === "product" ? "Stage 1" : stage === "stage1" ? "Stage 2" : stage === "stage2" ? "Stage 3" : "Stage 4";
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
  const [activeOverride, setActiveOverride] = useState<StageKey | null>(null);
  const [stage2View, setStage2View] = useState<"text" | "copy">("text");
  const [zippingImages, setZippingImages] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameOverride, setNameOverride] = useState<string | null>(null);

  // When the pipeline moves on, follow it to the stage that needs attention.
  useEffect(() => { setActiveOverride(null); }, [run?.status]);

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
      if (!data.success) push(`Couldn't start copy: ${data.error ?? "unknown error"}`);
    } catch (err) {
      push(`Couldn't start copy: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setTimeout(() => setStartingStage2(false), 1200); }
  }

  async function handleRestartStage(stage: RestartStage) {
    if (!runId || restarting) return;
    const isStage3 = stage === "stage3-prompts";
    if (!window.confirm(isStage3
      ? "Restart Stage 4? Deletes the hero, the 8 images and the placement."
      : stage === "product"
      ? "Restart Stage 1? Re-scrapes the links and clears the research."
      : `Restart ${stage === "stage1" ? "Stage 2" : "Stage 3"}? Clears its output and runs it again.`)) return;
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
      [run.meta.productDescription, `${slug}_PRODUCT_DESCRIPTION.txt`],
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
    product: getStageState(run, "product"),
    stage1: getStageState(run, "stage1"),
    stage2: getStageState(run, "stage2"),
    stage3: getStageState(run, "stage3"),
  };
  // The approval gate after research belongs on Stage 2 — that's what needs review.
  if (run.status === "awaiting_stage2_approval") { states.stage1 = "waiting"; states.stage2 = "pending"; }

  const openStage = (key: StageKey) => setActiveOverride(key);

  const summary = (key: StageKey): string | null => {
    if (key === "product") {
      const d = run.product?.descriptionEdited ?? run.product?.descriptionAi ?? run.meta.productDescription;
      if (!d) return null;
      return d.replace(/\s+/g, " ").slice(0, 90) + (d.length > 90 ? "…" : "") + (run.product?.descriptionEdited ? " · edited" : "");
    }
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
    product: Boolean(run.product?.scrape) || PRODUCT_DONE(run) || [...PRODUCT_ACTIVE, "awaiting_product_approval"].includes(run.status),
    stage1: Boolean(outputs.onePager) || ["stage1", "scraping"].includes(run.status) || Boolean(outputs.research) || PRODUCT_DONE(run),
    stage2: Boolean(outputs.stage2Output) || run.status === "stage2" || Boolean(outputs.onePager),
    stage3: Boolean(outputs.stage2Output) ||
      ["awaiting_user", "generating_hero", "awaiting_hero_qc", "generating_remaining", "awaiting_qc", "completed"].includes(run.status),
  };

  // ── Next action ──
  const nextAction = (): NextAction => {
    const s = run.status;
    if (s === "awaiting_product_approval") return { tone: "amber", icon: "review", title: "Review the product", sub: "Check the description, tick the photos.", cta: "Review", onClick: () => openStage("product") };
    if (s === "awaiting_stage2_approval") {
      const hasAngle = Boolean(run.angles?.selected);
      return hasAngle
        ? { tone: "amber", icon: "review", title: "Ready for copy", sub: "Built around the angle you picked.", cta: startingStage2 ? "Starting…" : "Run copy", onClick: handleStartStage2 }
        : { tone: "amber", icon: "review", title: "Pick an angle", sub: "Research is done.", cta: "Pick an angle", onClick: () => openStage("stage1") };
    }
    if (s === "awaiting_user") return { tone: "amber", icon: "image", title: "Ready for images", sub: "Hero first, then the 8.", cta: "Go to images", onClick: () => openStage("stage3") };
    if (s === "awaiting_hero_qc") return { tone: "amber", icon: "review", title: "Review the hero", sub: "It becomes the reference for the other 8.", cta: "Review hero", onClick: () => openStage("stage3") };
    if (s === "awaiting_qc") return { tone: "amber", icon: "review", title: "Review the 8 prompts", sub: "Then generate.", cta: "Review prompts", onClick: () => openStage("stage3") };
    if (s === "failed") return { tone: "red", icon: "alert", title: "Run failed" + (run.currentStep ? ` at ${run.currentStep}` : ""), sub: run.error || "Resume from the last step.", cta: resuming ? "Resuming…" : "Resume", onClick: handleResume };
    if (s === "cancelled") return { tone: "amber", icon: "alert", title: "Run cancelled", sub: "Resume to continue.", cta: resuming ? "Resuming…" : "Resume", onClick: handleResume };
    if (s === "completed") return { tone: "green", icon: "check", title: "Run complete" };
    return { tone: "accent", running: true, title: statusLabel(s), sub: run.currentStep || "Working…" };
  };
  const a = nextAction();
  const toneBar = { amber: "var(--color-amber)", red: "var(--color-red)", green: "var(--color-green)", accent: "var(--color-accent)" }[a.tone];
  const hasDocs = Boolean(outputs.onePager || outputs.stage2Output);
  const showPrimary = !a.running && run.status !== "completed";

  // The stage on screen: the operator's pick, else the one that needs them,
  // else the furthest one that exists.
  const presentKeys = STAGE_DEFS.map((d) => d.key).filter((k) => present[k]);
  const autoKey: StageKey =
    (presentKeys.find((k) => stageActionable(states[k])) ?? (run.status === "completed" ? "stage3" : presentKeys[presentKeys.length - 1])) ?? "product";
  const activeKey: StageKey = activeOverride && present[activeOverride] ? activeOverride : autoKey;
  const active = STAGE_DEFS.find((d) => d.key === activeKey)!;

  const railBtn = "cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tr hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 whitespace-nowrap";
  const stateDot: Record<StageState, string> = {
    complete: "bg-[var(--color-green)]", running: "bg-[var(--color-accent)] pulse-dot", waiting: "bg-[var(--color-amber)]",
    error: "bg-[var(--color-red)]", pending: "bg-[var(--color-border-strong)]",
  };
  const stateWord: Record<StageState, string> = { complete: "Done", running: "Running", waiting: "Needs you", error: "Failed", pending: "" };

  const pane = "min-h-0 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]";
  const spinner = (text: string) => (
    <div className="h-full grid place-items-center">
      <div className="text-center">
        <Icon.Loader className="w-4 h-4 text-[var(--color-accent)] mx-auto mb-2.5" />
        <p className="text-[12.5px] text-[var(--color-text-2)] ff-mono">{text}</p>
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-54px)] grid grid-cols-[264px_minmax(0,1fr)]" data-screen-label="Run">
      {/* ── left rail: run, stages, actions ── */}
      <aside className="border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
          <Link href="/" className="cursor-pointer inline-flex items-center gap-1 text-[11.5px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr mb-3">
            <Icon.ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-surface-3)]">
              {run.meta.uploadedSourceImages[0]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={run.meta.uploadedSourceImages[0]} alt="" className="w-full h-full object-cover" />
                : <MeshThumb id={runId ?? 0} className="w-full h-full" />}
            </div>
            <div className="min-w-0 group/name">
              {renaming ? (
                <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); } }}
                  className="w-full text-[14px] font-bold ff-display text-[var(--color-text)] bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded-[var(--radius-sm)] px-2 py-0.5 focus:outline-none focus:border-[var(--color-accent)]"
                  aria-label="Run name" />
              ) : (
                <button onClick={() => { setNameDraft(displayName); setRenaming(true); }} title="Rename" className="cursor-pointer text-left w-full">
                  <p className="text-[14px] font-bold ff-display text-[var(--color-text)] truncate leading-tight">{displayName}</p>
                </button>
              )}
              <p className="ff-mono text-[10.5px] text-[var(--color-text-4)] truncate">#{runId}{elapsed ? ` · ${elapsed}` : ""}</p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <StatusBadge status={run.status} stuck={isStuck(run)} />
            {runId !== null && <RunProductCode runId={Number(runId)} />}
          </div>
          {run.meta.productUrl && (
            <a href={run.meta.productUrl} target="_blank" rel="noopener noreferrer" className="block mt-2 text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr truncate">
              {truncateUrl(run.meta.productUrl, 40)}
            </a>
          )}
        </div>

        {/* stages */}
        <nav className="px-2 py-2">
          {STAGE_DEFS.map((def) => {
            const st = states[def.key];
            const on = def.key === activeKey;
            const can = present[def.key];
            return (
              <button key={def.key} disabled={!can} onClick={() => openStage(def.key)}
                className={cx("w-full flex items-center gap-3 px-2.5 py-2.5 rounded-[var(--radius-sm)] text-left tr",
                  can ? "cursor-pointer" : "cursor-default opacity-50",
                  on ? "bg-[var(--color-accent-weak)]" : "hover:bg-[var(--color-surface-2)]")}>
                <span className="w-6 h-6 rounded-full grid place-items-center shrink-0 border border-[var(--color-border-strong)] text-[11px] font-bold text-[var(--color-text-2)] bg-[var(--color-surface)]">
                  {st === "complete" ? <Icon.Check className="w-3 h-3" strokeWidth={3} /> : def.n}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={cx("block text-[13px] font-[650] truncate", on ? "text-[var(--color-text)]" : "text-[var(--color-text-2)]")}>{def.title}</span>
                  <span className="block text-[10.5px] text-[var(--color-text-4)] truncate">{stateWord[st] || def.what}</span>
                </span>
                <span className={cx("w-2 h-2 rounded-full shrink-0", stateDot[st])} />
              </button>
            );
          })}
        </nav>

        {/* what's happening */}
        {(a.running || run.currentStep) && !isTerminal && (
          <div className="mx-3 mb-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)]">
            <p className="ff-mono text-[10.5px] text-[var(--color-text-3)] leading-snug break-words">{run.currentStep || statusLabel(run.status)}</p>
          </div>
        )}

        <div className="mt-auto px-3 pb-3 pt-2 border-t border-[var(--color-border)] space-y-2">
          {runId !== null && <RunCost runId={runId} />}
          <div className="flex items-center gap-2 flex-wrap">
            {hasDocs && <button onClick={handleDownloadDocs} className={railBtn}><Icon.Download className="w-3.5 h-3.5" /> Docs</button>}
            <button onClick={handleDownloadImages} disabled={zippingImages} className={railBtn}><Icon.Image className="w-3.5 h-3.5" /> {zippingImages ? "…" : "Images"}</button>
            {a.running && !isTerminal && (
              <button onClick={handleKill} disabled={killing}
                className="cursor-pointer inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-3 py-[7px] text-[12px] font-[620] border bg-[var(--color-red-bg)] text-[var(--color-red)] tr hover:brightness-95 disabled:opacity-50"
                style={{ borderColor: "color-mix(in srgb, var(--color-red) 50%, transparent)" }}>
                <Icon.Stop className="w-3 h-3" /> {killing ? "Killing…" : "Kill"}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── main: the active stage, full height ── */}
      <section className="min-h-0 flex flex-col bg-[var(--color-bg)]">
        <header className="flex items-center justify-between gap-4 px-6 h-12 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">STAGE {active.n}</span>
            <h2 className="text-[15px] font-[700] ff-display text-[var(--color-text)]">{active.title}</h2>
            <span className="text-[12px] text-[var(--color-text-3)] truncate">{summary(active.key) ?? active.what}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeKey === "product" && runId !== null && <><PromptUsed promptsUsed={run.promptsUsed} stage="product" /><StageActions stage="product" onRestart={handleRestartStage} restarting={restarting} /></>}
            {activeKey === "stage1" && runId !== null && outputs.onePager && (
              <>
                <a href={`/api/runs/${runId}/stage1-docs`} download className={railBtn}><Icon.Download className="w-3.5 h-3.5" /> Docs</a>
                <PromptUsed promptsUsed={run.promptsUsed} stage="stage1" />
                <AIRegenerate runId={runId} stage="stage1" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage1Note ?? null} />
                <FeedbackButtons runId={runId} stage="stage1" initialVote={run.feedback?.stage1 ?? null} initialNote={run.feedback?.stage1Note ?? null} />
                <StageActions stage="stage1" onRestart={handleRestartStage} restarting={restarting} />
              </>
            )}
            {activeKey === "stage2" && runId !== null && outputs.stage2Output && (
              <>
                <PromptUsed promptsUsed={run.promptsUsed} stage="stage2" />
                <AIRegenerate runId={runId} stage="stage2" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage2Note ?? null} />
                <FeedbackButtons runId={runId} stage="stage2" initialVote={run.feedback?.stage2 ?? null} initialNote={run.feedback?.stage2Note ?? null} />
                <StageActions stage="stage2" onRestart={handleRestartStage} restarting={restarting} />
              </>
            )}
            {activeKey === "stage3" && runId !== null && <><PromptUsed promptsUsed={run.promptsUsed} stage="stage3" /><StageActions stage="stage3-prompts" onRestart={handleRestartStage} restarting={restarting} /></>}
          </div>
        </header>

        <div className="flex-1 min-h-0 p-4">
          {/* Stage 1 · Product */}
          {activeKey === "product" && (
            PRODUCT_ACTIVE.includes(run.status)
              ? <div className={cx(pane, "h-full")}>{spinner(run.currentStep ?? "Reading the product page…")}</div>
              : <div className={cx(pane, "h-full px-5 py-4")}>{runId !== null && <ProductGate runId={runId} run={run} onChanged={() => window.location.reload()} />}</div>
          )}

          {/* Stage 2 · Research: one-pager left, angles right */}
          {activeKey === "stage1" && (
            outputs.onePager ? (
              <div className="h-full grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4">
                <div className={cx(pane, "px-5 py-4")}>
                  <OnePagerMarkdown text={outputs.onePagerEdited ?? outputs.onePager ?? ""} />
                  {run.scrapeErrors && run.scrapeErrors.length > 0 && (
                    <p className="mt-4 text-[11px] text-[var(--color-amber)]">{run.scrapeErrors.length} competitor link{run.scrapeErrors.length === 1 ? "" : "s"} couldn&rsquo;t be read.</p>
                  )}
                  <div className="mt-4"><FeedbackAppliedChip stage={1} /></div>
                </div>
                <div className={cx(pane, "px-5 py-4")}>
                  {runId !== null && <AnglePicker runId={runId} run={run} editable={run.status === "awaiting_stage2_approval"} />}
                </div>
              </div>
            ) : ["stage1", "scraping"].includes(run.status) || outputs.research
              ? <div className={cx(pane, "h-full")}>{spinner(run.currentStep ?? "Researching…")}</div>
              : <div className={cx(pane, "h-full grid place-items-center")}><p className="text-[12.5px] text-[var(--color-text-3)]">Starts after you approve the product.</p></div>
          )}

          {/* Stage 3 · Copy */}
          {activeKey === "stage2" && (
            outputs.stage2Output ? (
              <div className="h-full flex flex-col gap-3 min-h-0">
                <div className="flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-1 p-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] border border-[var(--color-border)] w-fit">
                    {((stage2Json ? ["text", "copy"] : ["text"]) as Array<"text" | "copy">).map((v) => (
                      <button key={v} onClick={() => setStage2View(v)}
                        className={`px-3 py-1 rounded-[calc(var(--radius-sm)-2px)] text-[12px] font-[620] tr cursor-pointer ${stage2View === v ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-card)]" : "text-[var(--color-text-3)] hover:text-[var(--color-text)]"}`}>
                        {v === "text" ? "Full text" : "Fields"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <FeedbackAppliedChip stage={2} />
                    {runId !== null && stage2View === "copy" && <SendToDoc runId={runId} sentAt={run.outputs.gdocAppendedAt ?? null} />}
                  </div>
                </div>
                <div className={cx(pane, "flex-1 px-5 py-4")}>
                  {stage2View === "copy" && stage2Json ? (
                    <Stage2Shopify json={stage2Json} />
                  ) : (
                    <EditableOutput runId={Number(runId)} field="stage2_copy" stage="stage2" originalValue={outputs.stage2Output}
                      editedValue={outputs.stage2OutputEdited} editedAt={outputs.stage2EditedAt} label="Copy Kit" monospace={false} downloadFilename="STAGE2_COPY.txt" />
                  )}
                </div>
              </div>
            ) : run.status === "stage2"
              ? <div className={cx(pane, "h-full")}>{spinner("Generating copy…")}</div>
              : <div className={cx(pane, "h-full grid place-items-center")}><p className="text-[12.5px] text-[var(--color-text-3)]">Starts after you pick an angle.</p></div>
          )}

          {/* Stage 4 · Images */}
          {activeKey === "stage3" && (
            <div className={cx(pane, "h-full px-5 py-4")}>
              <Stage3HeroFlow runId={Number(runId)} stage2Ready={Boolean(outputs.stage2Output)} />
            </div>
          )}
        </div>

        {/* next action */}
        <footer className="shrink-0 px-4 pb-4">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
            style={{ borderColor: `color-mix(in srgb, ${toneBar} 35%, var(--color-border))` }}>
            <span className="grid place-items-center w-7 h-7 rounded-full shrink-0 text-white" style={{ background: toneBar }}>
              {a.running ? <Icon.Loader className="w-3.5 h-3.5" />
                : a.icon === "alert" ? <Icon.Alert className="w-3.5 h-3.5" />
                : a.icon === "check" ? <Icon.Check className="w-3.5 h-3.5" strokeWidth={3} />
                : a.icon === "image" ? <Icon.Image className="w-3.5 h-3.5" />
                : <Icon.Spark className="w-3.5 h-3.5" />}
            </span>
            <div className="flex-1 min-w-0 flex items-baseline gap-2">
              <p className="text-[13px] font-[650] text-[var(--color-text)] truncate">{a.title}</p>
              {a.sub && <p className="text-[11.5px] text-[var(--color-text-3)] truncate">{a.sub}</p>}
            </div>
            {showPrimary && a.cta && (
              <button onClick={a.onClick} disabled={startingStage2 || resuming}
                className="cursor-pointer shrink-0 inline-flex items-center gap-[7px] rounded-[var(--radius-sm)] px-[15px] py-[8px] text-[13px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent tr hover:brightness-110 disabled:opacity-60 whitespace-nowrap">
                {a.cta}<Icon.ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
