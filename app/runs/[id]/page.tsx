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
import { elapsedTime, statusLabel } from "@/components/ui/run-ui";
import { useToast } from "@/components/Toasts";
import AIRegenerate from "@/components/AIRegenerate";
import FeedbackButtons from "@/components/FeedbackButtons";
import FeedbackAppliedChip from "@/components/FeedbackAppliedChip";
import Stage3HeroFlow from "@/components/Stage3HeroFlow";
import EditableOutput from "@/components/EditableOutput";
import Stage2Shopify from "@/components/Stage2Shopify";
import type { Stage2Json } from "@/lib/stage2/shape";
import PromptUsed from "@/components/PromptUsed";
import RunCost from "@/components/RunCost";
import SendToDoc from "@/components/SendToDoc";
import SendToDrive from "@/components/SendToDrive";
import ProductGate from "@/components/ProductGate";
import AnglePicker from "@/components/AnglePicker";
import PricingCard from "@/components/PricingCard";
import { fmtMoney } from "@/lib/pricing";
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
  const [shopifyUrl, setShopifyUrl] = useState<string | null>(null);
  const [shopifySaved, setShopifySaved] = useState<"saved" | "error" | null>(null);
  async function saveShopifyUrl(v: string) {
    if (!runId) return;
    const clean = v.trim();
    setShopifySaved(null);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopify_product_url: clean || null }) });
      if (!res.ok) throw new Error();
      setShopifySaved("saved");
    } catch { setShopifySaved("error"); }
    setTimeout(() => setShopifySaved(null), 1500);
  }

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

  const stateTone: Record<StageState, string> = {
    complete: "var(--color-text-3)", running: "var(--color-accent)", waiting: "var(--color-amber)",
    error: "var(--color-red)", pending: "var(--color-text-4)",
  };
  const stateWord: Record<StageState, string> = { complete: "done", running: "running", waiting: "needs you", error: "failed", pending: "—" };
  const textBtn = "btn btn-sm";
  const deliverRow = "w-full grid items-center gap-2.5 px-2.5 h-[34px] rounded-[6px] text-left cursor-pointer hover:bg-[var(--color-surface-2)] tr disabled:cursor-default disabled:hover:bg-transparent";
  const deliverCols = { gridTemplateColumns: "minmax(0,1fr) auto" } as const;
  const DeliverRow = ({ name, state }: { name: string; state: string }) => (
    <div className={cx(deliverRow, "cursor-default opacity-45")} style={deliverCols}>
      <span className="text-[13px] font-[500] text-[var(--color-text)]">{name}</span>
      <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{state}</span>
    </div>
  );
  const RestartStage = ({ stage }: { stage: RestartStage }) => (
    <button onClick={() => handleRestartStage(stage)} disabled={restarting} className="btn btn-sm">
      {restarting ? "Restarting…" : "Restart stage"}
    </button>
  );
  const label = "eyebrow";
  const card = "border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)]";
  // Finished images exist — enough for Shopify and Drive, whatever the status word says.
  const imagesReady = run.status === "completed" || (run.stage4?.done ?? 0) > 0;
  const waiting = (text: string) => (
    <div className={cx(card, "px-5 py-10 grid place-items-center")}>
      <p className="ff-mono text-[12px] text-[var(--color-text-2)]">{text}</p>
    </div>
  );

  return (
    <div className="grid items-start" style={{ gridTemplateColumns: "268px minmax(0,1fr)", minHeight: "calc(100vh - 50px)" }} data-screen-label="Run">
      {/* ── rail ── */}
      <aside className="sticky border-r border-[var(--color-border)] px-4 py-5 flex flex-col gap-[18px] overflow-auto"
        style={{ top: 50, height: "calc(100vh - 50px)" }}>
        <div className="flex gap-[11px] items-start">
          <div className="w-[42px] h-[42px] shrink-0 rounded-[6px] border border-[var(--color-border)] grid place-items-center ff-mono text-[9px] text-[var(--color-text-3)] overflow-hidden"
            style={{ background: "repeating-linear-gradient(135deg,var(--color-surface-2) 0 4px,var(--color-bg) 4px 8px)" }}>
            {run.meta.uploadedSourceImages[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={run.meta.uploadedSourceImages[0]} alt="" className="w-full h-full object-cover" />
              : (run.meta.productCode || `#${runId}`)}
          </div>
          <div className="min-w-0">
            {renaming ? (
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); } }}
                className="w-full text-[14px] font-[500] bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[5px] px-2 py-0.5 outline-none focus:border-[var(--color-accent)]"
                aria-label="Run name" />
            ) : (
              <button onClick={() => { setNameDraft(displayName); setRenaming(true); }} title="Rename" className="cursor-pointer text-left">
                <div className="text-[14px] font-[500] leading-[1.25] text-[var(--color-text)]">{displayName}</div>
              </button>
            )}
            <div className="ff-mono text-[10.5px] text-[var(--color-text-3)] mt-[3px]">
              run {runId}{run.meta.productCode ? ` · ${run.meta.productCode}` : ""}{elapsed ? ` · ${elapsed}` : ""}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-px">
          {STAGE_DEFS.map((def) => {
            const st = states[def.key];
            const on = def.key === activeKey;
            return (
              <button key={def.key} disabled={!present[def.key]} onClick={() => openStage(def.key)}
                className={cx("grid items-center gap-2.5 px-2.5 py-[9px] rounded-[6px] text-left tr",
                  present[def.key] ? "cursor-pointer hover:bg-[var(--color-surface-2)]" : "cursor-default opacity-45",
                  on && "bg-[var(--color-surface-2)]")}
                style={{ gridTemplateColumns: "16px 1fr auto" }}>
                <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{def.n}</span>
                <span className={cx("text-[13px] font-[500]", on ? "text-[var(--color-text)]" : "text-[var(--color-text-2)]")}>{def.title}</span>
                <span className="ff-mono text-[11px]" style={{ color: stateTone[st] }}>{stateWord[st]}</span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-[var(--color-border)] pt-3.5 flex flex-col gap-[9px]">
          <span className={label}>Next</span>
          <p className="text-[13px] leading-[1.4] text-[var(--color-text)]">{a.title}{a.sub ? <span className="text-[var(--color-text-2)]"> — {a.sub}</span> : null}</p>
          {showPrimary && a.cta && (
            <button onClick={a.onClick} disabled={startingStage2 || resuming}
              className="cursor-pointer h-[34px] rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[13px] font-[500] hover:opacity-90 disabled:opacity-60 tr">
              {a.cta}
            </button>
          )}
          {run.currentStep && a.running && <p className="ff-mono text-[10.5px] text-[var(--color-text-3)] leading-snug">{run.currentStep}</p>}
        </div>

        {/* price: the Stage 3 suggestion, visible from every stage */}
        {run.meta.pricing && (
          <div className="border-t border-[var(--color-border)] pt-3.5 flex flex-col gap-2">
            <span className={label}>Price</span>
            <button onClick={() => openStage("stage2")} className={deliverRow} style={deliverCols} title="Opens the Pricing card on the Copy stage">
              <span className="ff-mono text-[13px] text-[var(--color-text)]">{fmtMoney(run.meta.pricing.price, run.meta.pricing.cogs_currency)} <span className="text-[var(--color-text-3)]">· cmp {fmtMoney(run.meta.pricing.compare_at, run.meta.pricing.cogs_currency)}</span></span>
              <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{(run.meta.pricing.price / run.meta.pricing.cogs).toFixed(1)}×</span>
            </button>
          </div>
        )}

        {/* deliver: the pushes out of the app, visible from every stage */}
        {runId !== null && (
          <div className="border-t border-[var(--color-border)] pt-3.5 flex flex-col gap-2">
            <span className={label}>Deliver</span>
            <div className="flex flex-col gap-px">
              {outputs.stage2Json
                ? <SendToDoc runId={runId} sentAt={run.outputs.gdocAppendedAt ?? null} variant="row" />
                : <DeliverRow name="Google Doc" state="after copy" />}
              <button onClick={() => openStage("stage3")} disabled={!imagesReady} className={deliverRow} style={deliverCols}
                title={imagesReady ? "Opens the Shopify push on the Images stage" : "Needs the finished images first"}>
                <span className="text-[13px] font-[500] text-[var(--color-text)]">Shopify</span>
                <span className="ff-mono text-[11px] text-[var(--color-text-3)]">{imagesReady ? "push →" : "after images"}</span>
              </button>
              {imagesReady
                ? <SendToDrive runId={runId} variant="row" />
                : <DeliverRow name="Drive" state="after images" />}
            </div>
            <input
              value={shopifyUrl ?? run.meta.shopifyProductUrl ?? ""}
              onChange={(e) => setShopifyUrl(e.target.value)}
              onBlur={(e) => saveShopifyUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="Shopify product link"
              spellCheck={false}
              title={shopifySaved === "error" ? "Needs an https:// link" : "The product this run fills — saved when you leave the field"}
              className={cx("mt-1 h-[30px] px-2.5 rounded-[6px] bg-transparent border text-[11.5px] ff-mono text-[var(--color-text-2)] outline-none focus:text-[var(--color-text)] focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-4)]",
                shopifySaved === "error" ? "border-[var(--color-red)]" : "border-[var(--color-border)]")}
            />
          </div>
        )}

        <div className="flex-1" />

        {runId !== null && <RunCost runId={runId} />}

        <div className="flex gap-2 flex-wrap">
          {hasDocs && <button onClick={handleDownloadDocs} className="btn btn-sm">Download docs</button>}
          <button onClick={handleDownloadImages} disabled={zippingImages} className="btn btn-sm">{zippingImages ? "Downloading…" : "Download images"}</button>
          {a.running && !isTerminal && (
            <button onClick={handleKill} disabled={killing} className="btn btn-sm btn-danger">{killing ? "Killing…" : "Kill run"}</button>
          )}
        </div>
      </aside>

      {/* ── main ── */}
      <div style={{ padding: "26px 30px 100px", maxWidth: 1000 }}>

        {/* Stage 1 · Product */}
        {activeKey === "product" && (
          <>
            <div className="flex items-baseline gap-2.5 mb-5">
              <h1 className="text-[17px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Product</h1>
              <span className="text-[12.5px] text-[var(--color-text-2)]">Check the description and pick the photos.</span>
              <div className="flex-1" />
              {runId !== null && (
                <div className="flex items-center gap-3.5">
                  <PromptUsed promptsUsed={run.promptsUsed} stage="product" />
                  <RestartStage stage="product" />
                </div>
              )}
            </div>
            {PRODUCT_ACTIVE.includes(run.status)
              ? waiting(run.currentStep ?? "Reading the product page…")
              : runId !== null && <ProductGate runId={runId} run={run} onChanged={() => window.location.reload()} />}
          </>
        )}

        {/* Stage 2 · Research */}
        {activeKey === "stage1" && (
          <>
            <div className="flex items-baseline gap-2.5 mb-5">
              <h1 className="text-[17px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Research</h1>
              <span className="text-[12.5px] text-[var(--color-text-2)]">Tick the angle to build on. First tick is primary.</span>
            </div>
            {outputs.onePager ? (
              <>
                {runId !== null && <div className="mb-[30px]"><AnglePicker runId={runId} run={run} editable={run.status === "awaiting_stage2_approval"} /></div>}
                <div>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span className={label}>One-pager</span>
                    <div className="flex-1" />
                    {runId !== null && (
                      <div className="flex gap-3.5 items-center">
                        <a href={`/api/runs/${runId}/stage1-docs`} download className="btn btn-sm">Download documents</a>
                        <PromptUsed promptsUsed={run.promptsUsed} stage="stage1" />
                        <AIRegenerate runId={runId} stage="stage1" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage1Note ?? null} />
                        <FeedbackButtons runId={runId} stage="stage1" initialVote={run.feedback?.stage1 ?? null} initialNote={run.feedback?.stage1Note ?? null} />
                        <RestartStage stage="stage1" />
                      </div>
                    )}
                  </div>
                  <div className={cx(card, "px-[22px] py-5")}>
                    <OnePagerMarkdown text={outputs.onePagerEdited ?? outputs.onePager ?? ""} />
                  </div>
                  {run.scrapeErrors && run.scrapeErrors.length > 0 && (
                    <p className="mt-3 text-[11.5px] text-[var(--color-amber)]">{run.scrapeErrors.length} competitor link{run.scrapeErrors.length === 1 ? "" : "s"} couldn&rsquo;t be read.</p>
                  )}
                  <div className="mt-3"><FeedbackAppliedChip stage={1} /></div>
                </div>
              </>
            ) : ["stage1", "scraping"].includes(run.status) || outputs.research
              ? waiting(run.currentStep ?? "Researching…")
              : waiting("Starts after you approve the product.")}
          </>
        )}

        {/* Stage 3 · Copy */}
        {activeKey === "stage2" && (
          <>
            <div className="flex items-center gap-3 mb-5">
              <h1 className="text-[17px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Copy</h1>
              <div className="flex-1" />
              {outputs.stage2Output && (
                <div className="flex gap-px p-0.5 rounded-[7px] bg-[var(--color-surface-2)]">
                  {((stage2Json ? ["text", "copy"] : ["text"]) as Array<"text" | "copy">).map((v) => (
                    <button key={v} onClick={() => setStage2View(v)}
                      className={cx("cursor-pointer px-[11px] py-[5px] rounded-[5px] text-[12.5px] tr",
                        stage2View === v ? "bg-[var(--color-surface)] text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)]")}>
                      {v === "text" ? "Full text" : "Fields"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {runId !== null && run.product.scrape && (
              <PricingCard runId={runId} scrape={run.product.scrape} pricing={run.meta.pricing ?? null} rules={run.meta.pricingRules} />
            )}
            {outputs.stage2Output ? (
              <>
                <div className="flex items-center gap-3.5 mb-2.5">
                  <span className={label}>{stage2View === "copy" ? "Store fields" : "Copy kit"}</span>
                  <div className="flex-1" />
                  {runId !== null && (
                    <div className="flex gap-3.5 items-center">
                      <SendToDoc runId={runId} sentAt={run.outputs.gdocAppendedAt ?? null} />
                      <PromptUsed promptsUsed={run.promptsUsed} stage="stage2" />
                      <AIRegenerate runId={runId} stage="stage2" onRegenerated={() => window.location.reload()} initialFeedback={run.feedback?.stage2Note ?? null} />
                      <FeedbackButtons runId={runId} stage="stage2" initialVote={run.feedback?.stage2 ?? null} initialNote={run.feedback?.stage2Note ?? null} />
                      <RestartStage stage="stage2" />
                    </div>
                  )}
                </div>
                {stage2View === "copy" && stage2Json ? (
                  <Stage2Shopify json={stage2Json} />
                ) : (
                  <EditableOutput runId={Number(runId)} field="stage2_copy" stage="stage2" originalValue={outputs.stage2Output}
                    editedValue={outputs.stage2OutputEdited} editedAt={outputs.stage2EditedAt} label="Copy kit" monospace={false} downloadFilename="STAGE2_COPY.txt" />
                )}
                <div className="mt-3"><FeedbackAppliedChip stage={2} /></div>
              </>
            ) : run.status === "stage2" ? waiting("Writing the copy…") : waiting("Starts after you pick an angle.")}
          </>
        )}

        {/* Stage 4 · Images */}
        {activeKey === "stage3" && (
          <>
            <div className="flex items-baseline gap-2.5 mb-5">
              <h1 className="text-[17px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Images</h1>
              <span className="text-[12.5px] text-[var(--color-text-2)]">Hero first, then the eight.</span>
              <div className="flex-1" />
              {runId !== null && (
                <div className="flex items-center gap-3.5">
                  <PromptUsed promptsUsed={run.promptsUsed} stage="stage3" />
                  <RestartStage stage="stage3-prompts" />
                </div>
              )}
            </div>
            <Stage3HeroFlow runId={Number(runId)} stage2Ready={Boolean(outputs.stage2Output)} />
          </>
        )}
      </div>
    </div>
  );
}
