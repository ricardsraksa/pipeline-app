"use client";

import { useState, useRef, useEffect } from "react";
import OutputBlock from "@/components/OutputBlock";
import FeedbackBar from "@/components/FeedbackBar";
import JSZip from "jszip";
import type { ImagePrompt } from "@/app/api/stage3-prompts/route";

type PipelineState =
  | "idle"
  | "scraping"
  | "step1_running" | "step1_done"
  | "step2_running" | "step2_done"
  | "step3_running" | "step3_done"
  | "step4a_running" | "step4a_done"
  | "step4b_running" | "step4b_done"
  | "step4c_running" | "step4c_done"
  | "step5_running" | "step5_done"
  | "step6_running" | "step6_done"
  | "complete"
  | "stage2_running"
  | "stage2_done"
  | "stage3_prompts_running"
  | "stage3_prompts_done"
  | "stage3_images_running"
  | "stage3_images_done"
  | "error";

interface ImageSlot {
  prompt: ImagePrompt;
  imageUrl?: string;
  status: "pending" | "loading" | "done" | "error";
  error?: string;
}

interface Outputs {
  research: string | null;
  chief_mid: string | null;
  research_revised: string | null;
  avatar: string | null;
  offer_brief: string | null;
  necessary_beliefs: string | null;
  chief_final: string | null;
  avatar_revised: string | null;
  offer_brief_revised: string | null;
  necessary_beliefs_revised: string | null;
}

const EMPTY_OUTPUTS: Outputs = {
  research: null,
  chief_mid: null,
  research_revised: null,
  avatar: null,
  offer_brief: null,
  necessary_beliefs: null,
  chief_final: null,
  avatar_revised: null,
  offer_brief_revised: null,
  necessary_beliefs_revised: null,
};

interface StepCardProps {
  stepNum: number;
  title: string;
  description: string;
  pipeline: PipelineState;
  errorStage: number | null;
  errorMessage: string;
  output: string | null;
  skipped?: boolean;
  slug: string;
  onRetry: () => void;
  children?: React.ReactNode;
}

function PhaseHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center gap-2.5">
      <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600 font-mono">{label}</span>
    </div>
  );
}

function getStepCardState(
  pipeline: PipelineState,
  errorStage: number | null,
  stepNum: number
): "locked" | "running" | "complete" | "error" {
  if (errorStage === stepNum) return "error";

  const runningStates: Record<number, PipelineState[]> = {
    1: ["scraping", "step1_running"],
    2: ["step2_running"],
    3: ["step3_running"],
    4: ["step4a_running"],
    5: ["step4b_running"],
    6: ["step4c_running"],
    7: ["step5_running"],
    8: ["step6_running"],
  };

  const doneAfterStates: Record<number, PipelineState[]> = {
    1: ["step1_done", "step2_running", "step2_done", "step3_running", "step3_done", "step4a_running", "step4a_done", "step4b_running", "step4b_done", "step4c_running", "step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    2: ["step2_done", "step3_running", "step3_done", "step4a_running", "step4a_done", "step4b_running", "step4b_done", "step4c_running", "step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    3: ["step3_done", "step4a_running", "step4a_done", "step4b_running", "step4b_done", "step4c_running", "step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    4: ["step4a_done", "step4b_running", "step4b_done", "step4c_running", "step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    5: ["step4b_done", "step4c_running", "step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    6: ["step4c_done", "step5_running", "step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    7: ["step5_done", "step6_running", "step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
    8: ["step6_done", "complete", "stage2_running", "stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"],
  };

  if (runningStates[stepNum]?.includes(pipeline)) return "running";
  if (doneAfterStates[stepNum]?.includes(pipeline)) return "complete";
  return "locked";
}

function ResearchStepCard({
  stepNum,
  title,
  description,
  pipeline,
  errorStage,
  errorMessage,
  output,
  skipped,
  slug,
  onRetry,
  children,
}: StepCardProps) {
  const [outputExpanded, setOutputExpanded] = useState(false);

  const cardState = getStepCardState(pipeline, errorStage, stepNum);
  const isRunning = cardState === "running";
  const isComplete = cardState === "complete";
  const isError = cardState === "error";

  function downloadTxt(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const filenameMap: Record<number, string> = {
    1: "RESEARCH.txt",
    2: "CHIEF_MID.txt",
    3: "RESEARCH_REVISED.txt",
    4: "AVATAR.txt",
    5: "OFFER_BRIEF.txt",
    6: "NECESSARY_BELIEFS.txt",
    7: "CHIEF_FINAL.txt",
    8: "FINAL_REVISIONS.txt",
  };

  const isLocked = !isRunning && !isComplete && !isError;

  const badgeCls = isError
    ? "bg-red-500/10 text-red-400 border border-red-500/30"
    : isRunning
    ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
    : isComplete
    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
    : "bg-zinc-900 text-zinc-600 border border-zinc-800";

  return (
    <div className={`border-b border-zinc-800 last:border-b-0 py-3.5 px-4 transition-all duration-150 ${isLocked ? "opacity-20 pointer-events-none" : ""}`}>
      {/* Row header */}
      <div className="flex items-center gap-3">
        <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono flex-shrink-0 select-none ${badgeCls} ${isRunning ? "animate-pulse" : ""}`}>
          {isComplete ? "✓" : isError ? "!" : stepNum}
        </span>
        <span className={`text-[13px] font-medium flex-1 leading-none ${
          isRunning || isComplete ? "text-zinc-100" : "text-zinc-500"
        }`}>
          {title}
        </span>
        {isRunning && (
          <span className="text-[10px] font-mono text-blue-400 animate-pulse">running…</span>
        )}
        {isComplete && !isRunning && output && !skipped && (
          <button
            onClick={() => setOutputExpanded(v => !v)}
            className="cursor-pointer text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors duration-150"
          >
            {outputExpanded ? "hide ↑" : "view ↓"}
          </button>
        )}
        {isComplete && !isRunning && (!output || skipped) && (
          <span className="text-[10px] font-mono text-zinc-600">{skipped ? "skipped" : "done"}</span>
        )}
        {isError && (
          <span className="text-[10px] font-mono text-red-400">error</span>
        )}
      </div>

      {/* Description — shown when not locked */}
      {!isLocked && (
        <p className="text-[11px] text-zinc-500 mt-0.5 pl-8">{description}</p>
      )}

      {/* Error state */}
      {isError && (
        <div className="mt-3 pl-8 space-y-2">
          <p className="text-[11px] text-red-400 font-mono">{errorMessage}</p>
          <button
            onClick={onRetry}
            className="cursor-pointer px-3 py-1.5 border border-red-900/50 text-red-400 hover:bg-red-950/40 rounded-lg text-xs transition-colors active:scale-95"
          >
            Retry step {stepNum}
          </button>
        </div>
      )}

      {/* Output — collapsible */}
      {isComplete && output && outputExpanded && (
        <div className="mt-3 pl-8 space-y-2 fade-in">
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-80 overflow-y-auto">
            {output}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyToClipboard(output)}
              className="cursor-pointer px-3 py-1.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-[11px] font-mono transition-colors active:scale-95"
            >
              Copy
            </button>
            <button
              onClick={() => downloadTxt(`${slug}_${filenameMap[stepNum] ?? `step${stepNum}.txt`}`, output)}
              className="cursor-pointer px-3 py-1.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-[11px] font-mono transition-colors active:scale-95"
            >
              ↓ .txt
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}


export default function Home() {
  const [url, setUrl] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>("idle");
  const [errorStage, setErrorStage] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [outputs, setOutputs] = useState<Outputs>(EMPTY_OUTPUTS);
  const [brandSlug, setBrandSlug] = useState<string | null>(null);
  const [productSlug, setProductSlug] = useState<string | null>(null);

  // Image generation state (kept from original)
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [userImages, setUserImages] = useState<string[]>([]);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [productName, setProductName] = useState("");
  const [stage2Output, setStage2Output] = useState("");
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [ambiguousListing, setAmbiguousListing] = useState(false);
  const [currentTab, setCurrentTab] = useState<1 | 2 | 3>(1);
  const [selectedStep, setSelectedStep] = useState<number>(1);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const productNameRef = useRef<HTMLInputElement>(null);

  // Auto-focus product name input when Stage 2 tab is opened
  useEffect(() => {
    if (currentTab === 2 && productNameRef.current && !stage2Output) {
      setTimeout(() => productNameRef.current?.focus(), 80);
    }
  }, [currentTab, stage2Output]);

  // Auto-select the currently-running or just-completed step for the detail panel
  const pipelineForEffect = pipeline;
  useEffect(() => {
    const m: Partial<Record<PipelineState, number>> = {
      step1_running: 1, step1_done: 1,
      step2_running: 2, step2_done: 2,
      step3_running: 3, step3_done: 3,
      step4a_running: 4, step4a_done: 4,
      step4b_running: 5, step4b_done: 5,
      step4c_running: 6, step4c_done: 6,
      step5_running: 7, step5_done: 7,
      step6_running: 8, step6_done: 8,
      complete: 8,
    };
    const target = m[pipelineForEffect];
    if (target) setSelectedStep(target);
  }, [pipelineForEffect]);

  const allImages = [...scrapedImages, ...userImages];

  function setError(stage: number, msg: string) {
    setErrorStage(stage);
    setErrorMessage(msg);
    setPipeline("error");
  }

  function toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);
  }

  function extractBrandSlug(offerBriefText: string): string | null {
    // Helper: extract brand name from a single list line (bullet or numbered)
    function parseBrandLine(line: string): string | null {
      // Strip leading bullet/number: "- ", "* ", "1. ", "1) "
      const stripped = line.replace(/^(?:[-*]|\d+[.):])\s+/, "").replace(/\*\*/g, "").trim();
      if (!stripped) return null;
      // Take only the part before " - ", " – ", " — ", or " (" (description separator)
      const name = stripped.split(/\s+[-–—]\s+|\s+\(/)[0].trim();
      if (name.length > 0 && name.length < 60) return name;
      return null;
    }

    // Regex to find first list item (bullet or numbered)
    const isListLine = (l: string) => /^(?:[-*]|\d+[.):])\s+\S/.test(l);

    // Step 1: Find "Brand Name Options/Suggestions" section, grab first list item
    const optionsMatch = offerBriefText.match(
      /brand name[^\n]*?(?:options?|suggestions?)[^\n]*\n([\s\S]{0,600}?)(?=\n\n\d\.|\n\n\*\*\d\.|\n\n##|$)/i
    );
    if (optionsMatch) {
      const block = optionsMatch[1];
      const listLine = block.split("\n").find(isListLine);
      if (listLine) {
        const name = parseBrandLine(listLine);
        if (name) return toSlug(name) || null;
      }
    }

    // Step 2: Broader fallback — any "brand name" or "product name" section, first list item
    const sectionMatch = offerBriefText.match(/(?:product name|brand name)[^\n]*\n([\s\S]{0,600}?)(?:\n\n|\n##)/i);
    if (sectionMatch) {
      const block = sectionMatch[1];
      const listLine = block.split("\n").find(isListLine);
      if (listLine) {
        const name = parseBrandLine(listLine);
        if (name) return toSlug(name) || null;
      }
      // Step 3: Last resort — first non-empty, non-header line in block
      const firstLine = block.split("\n")
        .map(l => l.replace(/^[-*\d.):\s#*]+/, "").trim())
        .find(l => l.length > 0 && l.length < 60 && !l.includes(":"));
      return firstLine ? toSlug(firstLine) || null : null;
    }

    return null;
  }

  // Same logic as extractBrandSlug but returns the raw (un-slugified) display name
  function extractRawBrandName(offerBriefText: string): string | null {
    function parseLine(line: string): string | null {
      const stripped = line.replace(/^(?:[-*]|\d+[.):])\s+/, "").replace(/\*\*/g, "").trim();
      if (!stripped) return null;
      const name = stripped.split(/\s+[-–—]\s+|\s+\(/)[0].trim();
      return name.length > 0 && name.length < 60 ? name : null;
    }
    const isListLine = (l: string) => /^(?:[-*]|\d+[.):])\s+\S/.test(l);
    const optionsMatch = offerBriefText.match(
      /brand name[^\n]*?(?:options?|suggestions?)[^\n]*\n([\s\S]{0,600}?)(?=\n\n\d\.|\n\n\*\*\d\.|\n\n##|$)/i
    );
    if (optionsMatch) {
      const listLine = optionsMatch[1].split("\n").find(isListLine);
      if (listLine) { const n = parseLine(listLine); if (n) return n; }
    }
    const sectionMatch = offerBriefText.match(/(?:product name|brand name)[^\n]*\n([\s\S]{0,600}?)(?:\n\n|\n##)/i);
    if (sectionMatch) {
      const listLine = sectionMatch[1].split("\n").find(isListLine);
      if (listLine) { const n = parseLine(listLine); if (n) return n; }
    }
    return null;
  }

  function extractProductSlug(researchText: string): string | null {
    // Look for Section 1 / Product Identification
    const match = researchText.match(/(?:1\.|product identification)[^\n]*\n([\s\S]{0,400}?)(?:\n\n\d\.|\n\n##)/i);
    if (!match) return null;
    // Try to pull a product name from the first meaningful line
    const firstLine = match[1].split("\n").map(l => l.replace(/^[-*\s]+/, "").trim()).find(l => l.length > 3 && l.length < 80);
    return firstLine ? toSlug(firstLine) || null : null;
  }

  function getFileSlug(brand: string | null, product: string | null): string {
    if (brand) return brand;
    if (product) return product;
    const d = new Date();
    return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, "0")}_${String(d.getDate()).padStart(2, "0")}`;
  }

  // Scrape helper
  async function scrapeAll(): Promise<{
    scraped: string;
    imgs: string[];
    competitorScraped: { url: string; text: string }[];
  }> {
    const competitorList = competitorUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    let scraped = "";
    let imgs: string[] = [];
    let competitorScraped: { url: string; text: string }[] = [];

    try {
      const allUrls = [url.trim(), ...competitorList];
      const scrapeResults = await Promise.allSettled(
        allUrls.map((u) =>
          fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: u }),
          }).then((r) => r.json())
        )
      );

      const mainResult = scrapeResults[0];
      if (mainResult.status === "fulfilled" && mainResult.value.success) {
        scraped = mainResult.value.scraped_text ?? "";
        imgs = mainResult.value.images ?? [];
      }

      for (let i = 1; i < scrapeResults.length; i++) {
        const r = scrapeResults[i];
        if (r.status === "fulfilled" && r.value.success) {
          const compImgs: string[] = r.value.images ?? [];
          for (const img of compImgs) {
            if (!imgs.includes(img)) imgs.push(img);
          }
          if (r.value.scraped_text) {
            competitorScraped.push({ url: competitorList[i - 1], text: r.value.scraped_text });
          }
        }
      }

      setScrapedImages(imgs);
      if (imgs.length < 2) setShowImageUploader(true);
    } catch {
      setShowImageUploader(true);
    }

    return { scraped, imgs, competitorScraped };
  }

  async function runPipeline() {
    if (!url.trim()) return;

    setErrorStage(null);
    setErrorMessage("");
    setOutputs(EMPTY_OUTPUTS);
    setStage2Output("");
    setImageSlots([]);
    setScrapedImages([]);
    setShowImageUploader(false);
    setRunId(null);
    setProductName("");
    setBrandSlug(null);
    setProductSlug(null);
    setCurrentTab(1);
    setSelectedStep(1);

    const competitorList = competitorUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    // Scrape
    setPipeline("scraping");
    const { scraped, imgs, competitorScraped } = await scrapeAll();

    // Validate scraped data is sufficient before starting the research step
    const hasContent = scraped.length > 50;
    const hasImages = imgs.length >= 1;
    const isAmbiguous = !hasContent || !hasImages;

    if (isAmbiguous && !productDescription.trim()) {
      setAmbiguousListing(true);
      setPipeline("idle");
      // Scroll to and focus the Product Description field so the user sees what to fill in
      setTimeout(() => {
        descriptionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        descriptionRef.current?.focus();
      }, 100);
      return;
    }
    setAmbiguousListing(false);

    // Step 1 — Research
    setPipeline("step1_running");
    let research = "";
    try {
      const res = await fetch("/api/pipeline/step1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: url.trim(),
          product_description: productDescription,
          scraped_text: scraped,
          competitor_urls: competitorList,
          competitor_scraped: competitorScraped,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Step 1 failed");
      research = data.output;
      setOutputs((prev) => ({ ...prev, research }));
      const pSlug = extractProductSlug(research);
      setProductSlug(pSlug);
      setPipeline("step1_done");
    } catch (err) {
      setError(1, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 2 — Chief Mid Review
    setPipeline("step2_running");
    let chiefMid = "";
    try {
      const data = await fetch("/api/pipeline/step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 2 failed");
      chiefMid = data.output;
      setOutputs((prev) => ({ ...prev, chief_mid: chiefMid }));
      setPipeline("step2_done");
    } catch (err) {
      setError(2, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 3 — Revise Research
    setPipeline("step3_running");
    let researchRevised = "";
    try {
      const data = await fetch("/api/pipeline/step3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research, chief_mid: chiefMid }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 3 failed");
      researchRevised = data.output;
      setOutputs((prev) => ({ ...prev, research_revised: data.output }));
      setPipeline("step3_done");
    } catch (err) {
      setError(3, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 4a — Avatar
    setPipeline("step4a_running");
    let avatar = "";
    try {
      const data = await fetch("/api/pipeline/step4a", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research: researchRevised }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 4a failed");
      avatar = data.output;
      setOutputs((prev) => ({ ...prev, avatar: data.output }));
      setPipeline("step4a_done");
    } catch (err) {
      setError(4, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 4b — Offer Brief
    setPipeline("step4b_running");
    let offerBrief = "";
    try {
      const data = await fetch("/api/pipeline/step4b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research: researchRevised, avatar }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 4b failed");
      offerBrief = data.output;
      setOutputs((prev) => ({ ...prev, offer_brief: offerBrief }));
      const bSlug = extractBrandSlug(offerBrief);
      setBrandSlug(bSlug);
      // Pre-fill Stage 2 product name from the offer brief brand suggestions
      const rawName = extractRawBrandName(offerBrief);
      if (rawName) setProductName(rawName);
      setPipeline("step4b_done");
    } catch (err) {
      setError(5, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 4c — Necessary Beliefs
    setPipeline("step4c_running");
    let necessaryBeliefs = "";
    try {
      const data = await fetch("/api/pipeline/step4c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ research: researchRevised, avatar, offer_brief: offerBrief }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 4c failed");
      necessaryBeliefs = data.output;
      setOutputs((prev) => ({ ...prev, necessary_beliefs: data.output }));
      setPipeline("step4c_done");
    } catch (err) {
      setError(6, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 5 — Chief Final Review
    setPipeline("step5_running");
    let chiefFinal = "";
    try {
      const data = await fetch("/api/pipeline/step5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          research_revised: researchRevised,
          avatar,
          offer_brief: offerBrief,
          necessary_beliefs: necessaryBeliefs,
        }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 5 failed");
      chiefFinal = data.output;
      setOutputs((prev) => ({ ...prev, chief_final: data.output }));
      setPipeline("step5_done");
    } catch (err) {
      setError(7, err instanceof Error ? err.message : String(err));
      return;
    }

    // Step 6 — Final Revisions
    setPipeline("step6_running");
    let avatarRevised: string | null = null;
    let offerBriefRevised: string | null = null;
    let necessaryBeliefsRevised: string | null = null;
    try {
      const data = await fetch("/api/pipeline/step6", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chief_final: chiefFinal,
          avatar,
          offer_brief: offerBrief,
          necessary_beliefs: necessaryBeliefs,
        }),
      }).then((r) => r.json());
      if (!data.success) throw new Error(data.error ?? "Step 6 failed");
      avatarRevised = data.avatar_revised ?? null;
      offerBriefRevised = data.offer_brief_revised ?? null;
      necessaryBeliefsRevised = data.necessary_beliefs_revised ?? null;
      setOutputs((prev) => ({
        ...prev,
        avatar_revised: avatarRevised,
        offer_brief_revised: offerBriefRevised,
        necessary_beliefs_revised: necessaryBeliefsRevised,
      }));
      setPipeline("complete");
    } catch (err) {
      setError(8, err instanceof Error ? err.message : String(err));
      return;
    }

    // Save run to DB after pipeline completes
    try {
      const revisedSteps: number[] = [];
      if (avatarRevised && avatarRevised !== avatar) revisedSteps.push(4);
      if (offerBriefRevised && offerBriefRevised !== offerBrief) revisedSteps.push(5);
      if (necessaryBeliefsRevised && necessaryBeliefsRevised !== necessaryBeliefs) revisedSteps.push(6);

      const localBrandSlug = extractBrandSlug(offerBrief);

      const saveRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: url.trim(),
          product_name: (localBrandSlug ?? productSlug ?? productName) || url.trim(),
          product_description: productDescription || null,
          competitor_urls: competitorList.length > 0 ? competitorList : undefined,
          scraper_data: { scraped_text: scraped, images: imgs },
          brand_name: localBrandSlug ?? null,
          status: "complete",
          step_research: research,
          step_chief_mid: chiefMid,
          step_research_revised: researchRevised,
          step_avatar: avatar,
          step_offer_brief: offerBrief,
          step_necessary_beliefs: necessaryBeliefs,
          step_chief_final: chiefFinal,
          step_avatar_revised: avatarRevised,
          step_offer_brief_revised: offerBriefRevised,
          step_necessary_beliefs_revised: necessaryBeliefsRevised,
          revised_steps: revisedSteps,
        }),
      });
      const saveData = await saveRes.json();
      if (saveData.id) setRunId(Number(saveData.id));
    } catch {
      // Non-critical — pipeline is complete regardless
    }
  }

  async function downloadAll() {
    const slug = getFileSlug(brandSlug, productSlug);
    const zip = new JSZip();
    zip.file(`${slug}_RESEARCH.txt`, outputs.research_revised ?? "");
    zip.file(`${slug}_AVATAR.txt`, outputs.avatar_revised ?? "");
    zip.file(`${slug}_OFFER_BRIEF.txt`, outputs.offer_brief_revised ?? "");
    zip.file(`${slug}_NECESSARY_BELIEFS.txt`, outputs.necessary_beliefs_revised ?? "");
    zip.file(`${slug}_CHIEF_MID.txt`, outputs.chief_mid ?? "");
    zip.file(`${slug}_CHIEF_FINAL.txt`, outputs.chief_final ?? "");
    const blob = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${slug}_research_docs.zip`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }

  // Image generation (kept from original)
  async function runStage2() {
    if (!outputs.research_revised && !outputs.research) return;
    setErrorStage(null);
    setErrorMessage("");
    setPipeline("stage2_running");

    try {
      const res = await fetch("/api/stage2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage1_output: outputs.research_revised ?? outputs.research ?? "",
          product_name: productName,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Stage 2 failed");
      setStage2Output(data.output);
      setPipeline("stage2_done");
    } catch (err) {
      setError(12, err instanceof Error ? err.message : String(err));
    }
  }

  async function runStage3() {
    if (!stage2Output) return;
    setErrorStage(null);
    setErrorMessage("");
    setPipeline("stage3_prompts_running");

    try {
      const res = await fetch("/api/stage3-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage2_output: stage2Output,
          product_url: url.trim(),
          images: allImages,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Stage 3 prompt generation failed");

      const prompts: ImagePrompt[] = data.prompts;
      const slots: ImageSlot[] = prompts.map((p) => ({ prompt: p, status: "pending" }));
      setImageSlots(slots);
      setPipeline("stage3_prompts_done");

      await generateImagesSequentially(prompts, slots);
    } catch (err) {
      setError(13, err instanceof Error ? err.message : String(err));
    }
  }

  async function generateImagesSequentially(prompts: ImagePrompt[], initialSlots: ImageSlot[]) {
    setPipeline("stage3_images_running");
    const slots = [...initialSlots];

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      setCurrentImageIndex(prompt.index);
      slots[i] = { ...slots[i], status: "loading" };
      setImageSlots([...slots]);

      let succeeded = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch("/api/stage3-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt_obj: prompt, images: allImages }),
          });
          const data = await res.json();
          if (data.success && data.image_url) {
            slots[i] = { ...slots[i], status: "done", imageUrl: data.image_url };
            setImageSlots([...slots]);
            succeeded = true;
            break;
          } else if (attempt === 1) {
            slots[i] = { ...slots[i], status: "error", error: data.error ?? "Generation failed" };
            setImageSlots([...slots]);
          }
        } catch (err) {
          if (attempt === 1) {
            slots[i] = {
              ...slots[i],
              status: "error",
              error: err instanceof Error ? err.message : "Network error",
            };
            setImageSlots([...slots]);
          }
        }
      }

      if (!succeeded && slots[i].status !== "error") {
        slots[i] = { ...slots[i], status: "error", error: "Failed after retry" };
        setImageSlots([...slots]);
      }
    }

    setCurrentImageIndex(null);
    setPipeline("stage3_images_done");

    const imageUrls = slots
      .filter((s) => s.status === "done" && s.imageUrl)
      .map((s) => s.imageUrl as string);

    try {
      // If we already have a runId (saved after pipeline), PATCH it with image data
      // Otherwise POST a new run (e.g. if only stage3 was done)
      const currentRunId = runId;
      if (currentRunId) {
        await fetch(`/api/runs/${currentRunId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage2_output: stage2Output,
            stage3_prompts: prompts,
            image_urls: imageUrls,
            status: "complete",
          }),
        });
      } else {
        const saveRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_url: url.trim(),
            product_name: brandSlug ?? productSlug ?? productName,
            stage1_output: outputs.research_revised ?? outputs.research ?? "",
            stage2_output: stage2Output,
            stage3_prompts: prompts,
            image_urls: imageUrls,
          }),
        });
        const saveData = await saveRes.json();
        if (saveData.id) setRunId(Number(saveData.id));
      }
    } catch {
      // Non-critical
    }
  }

  async function retryImage(index: number) {
    const slotIndex = imageSlots.findIndex((s) => s.prompt.index === index);
    if (slotIndex === -1) return;

    const updated = [...imageSlots];
    updated[slotIndex] = { ...updated[slotIndex], status: "loading", error: undefined };
    setImageSlots([...updated]);
    setCurrentImageIndex(index);
    setPipeline("stage3_images_running");

    try {
      const res = await fetch("/api/stage3-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_obj: imageSlots[slotIndex].prompt, images: allImages }),
      });
      const data = await res.json();
      if (data.success && data.image_url) {
        updated[slotIndex] = { ...updated[slotIndex], status: "done", imageUrl: data.image_url };
      } else {
        updated[slotIndex] = {
          ...updated[slotIndex],
          status: "error",
          error: data.error ?? "Retry failed",
        };
      }
    } catch (err) {
      updated[slotIndex] = {
        ...updated[slotIndex],
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      };
    }

    setImageSlots([...updated]);
    setCurrentImageIndex(null);
    const allSettled = updated.every((s) => s.status === "done" || s.status === "error");
    if (allSettled) setPipeline("stage3_images_done");
  }

  const pStr = pipeline as string;
  const isActive =
    pStr !== "idle" && pStr !== "error" && pStr !== "complete";
  const canStartPipeline = url.trim().length > 0 && pStr === "idle";
  const showPipeline = pStr !== "idle";
  const isComplete = pStr === "complete";
  // Compute image-stage booleans outside JSX to avoid TypeScript narrowing issues
  const pipelineIsStage2Running = (pipeline as string) === "stage2_running";
  const pipelineIsStage2Done = (pipeline as string) === "stage2_done";
  const pipelineIsStage3PromptsRunning = (pipeline as string) === "stage3_prompts_running";
  const pipelineIsStage3ImagesRunning = (pipeline as string) === "stage3_images_running";
  const pipelineIsStage3ImagesDone = (pipeline as string) === "stage3_images_done";
  const canRunStage2 =
    (isComplete || pipelineIsStage2Done || pipelineIsStage3ImagesDone) &&
    productName.trim().length > 0;
  const hasEnoughImages = allImages.length >= 2;
  const canRunStage3 =
    pipelineIsStage2Done && (!showImageUploader || hasEnoughImages);
  const isDone = pipelineIsStage3ImagesDone;

  const step6Skipped =
    outputs.avatar_revised !== null &&
    outputs.avatar_revised === outputs.avatar &&
    outputs.offer_brief_revised === outputs.offer_brief &&
    outputs.necessary_beliefs_revised === outputs.necessary_beliefs;

  const stepsCompleted =
    pipeline === "idle" ? 0 :
    pipeline === "scraping" || pipeline === "step1_running" ? 0 :
    pipeline === "step1_done" || pipeline === "step2_running" ? 1 :
    pipeline === "step2_done" || pipeline === "step3_running" ? 2 :
    pipeline === "step3_done" || pipeline === "step4a_running" ? 3 :
    pipeline === "step4a_done" || pipeline === "step4b_running" ? 4 :
    pipeline === "step4b_done" || pipeline === "step4c_running" ? 5 :
    pipeline === "step4c_done" || pipeline === "step5_running" ? 6 :
    pipeline === "step5_done" || pipeline === "step6_running" ? 7 :
    8;

  const statusLabel =
    pipeline === "scraping"        ? "Fetching product page" :
    pipeline === "step1_running"   ? "Step 1 — Generating research" :
    pipeline === "step2_running"   ? "Step 2 — Running mid chief review" :
    pipeline === "step3_running"   ? "Step 3 — Revising research" :
    pipeline === "step4a_running"  ? "Step 4a — Building avatar" :
    pipeline === "step4b_running"  ? "Step 4b — Writing offer brief" :
    pipeline === "step4c_running"  ? "Step 4c — Identifying necessary beliefs" :
    pipeline === "step5_running"   ? "Step 5 — Running final chief review" :
    pipeline === "step6_running"   ? "Step 6 — Applying final revisions" :
    pipeline === "stage2_running"  ? "Stage 2 — Generating German copy" :
    pipeline === "stage3_prompts_running" ? "Stage 3 — Building image prompts" :
    pipeline === "stage3_images_running" ? "Stage 3 — Generating images" : "";

  // Static metadata for the 8 steps — drives both the stepper and the master list
  const STEP_META: { num: number; title: string; short: string; desc: string; phase: "Research" | "Strategy" | "Review" }[] = [
    { num: 1, title: "Step 1 — Research",            short: "Research",          desc: "Deep market research for the German DTC market", phase: "Research" },
    { num: 2, title: "Step 2 — Mid Chief Review",    short: "Mid Review",        desc: "Senior editor review of the research document", phase: "Research" },
    { num: 3, title: "Step 3 — Research (Revised)",  short: "Revised",           desc: "Research revised based on chief review", phase: "Research" },
    { num: 4, title: "Step 4a — Avatar",             short: "Avatar",            desc: "Ideal customer avatar for the German market", phase: "Strategy" },
    { num: 5, title: "Step 4b — Offer Brief",        short: "Offer Brief",       desc: "Offer strategy grounded in research and avatar", phase: "Strategy" },
    { num: 6, title: "Step 4c — Necessary Beliefs",  short: "Beliefs",           desc: "6 beliefs the German prospect must hold before buying", phase: "Strategy" },
    { num: 7, title: "Step 5 — Final Chief Review",  short: "Final Review",      desc: "Cross-document consistency and argument soundness review", phase: "Review" },
    { num: 8, title: "Step 6 — Final Revisions",     short: "Final Revisions",   desc: "Documents revised based on final chief review", phase: "Review" },
  ];

  const filenameMap: Record<number, string> = {
    1: "RESEARCH.txt", 2: "CHIEF_MID.txt", 3: "RESEARCH_REVISED.txt",
    4: "AVATAR.txt",   5: "OFFER_BRIEF.txt", 6: "NECESSARY_BELIEFS.txt",
    7: "CHIEF_FINAL.txt", 8: "FINAL_REVISIONS.txt",
  };

  function getStepOutput(num: number): string | null {
    switch (num) {
      case 1: return outputs.research;
      case 2: return outputs.chief_mid;
      case 3: return outputs.research_revised;
      case 4: return outputs.avatar;
      case 5: return outputs.offer_brief;
      case 6: return outputs.necessary_beliefs;
      case 7: return outputs.chief_final;
      case 8: return outputs.avatar_revised
        ? ["=== AVATAR.txt (revised) ===", outputs.avatar_revised,
           "\n=== OFFER_BRIEF.txt (revised) ===", outputs.offer_brief_revised ?? "",
           "\n=== NECESSARY_BELIEFS.txt (revised) ===", outputs.necessary_beliefs_revised ?? ""].join("\n\n")
        : null;
      default: return null;
    }
  }

  async function retryStep(num: number) {
    setErrorStage(null);
    setErrorMessage("");
    if (num === 1) { runPipeline(); return; }
    const handlers: Record<number, () => Promise<void>> = {
      2: async () => {
        if (!outputs.research) return;
        setPipeline("step2_running");
        const data = await fetch("/api/pipeline/step2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: outputs.research }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 2 failed");
        setOutputs(p => ({ ...p, chief_mid: data.output })); setPipeline("step2_done");
      },
      3: async () => {
        if (!outputs.research || !outputs.chief_mid) return;
        setPipeline("step3_running");
        const data = await fetch("/api/pipeline/step3", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: outputs.research, chief_mid: outputs.chief_mid }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 3 failed");
        setOutputs(p => ({ ...p, research_revised: data.output })); setPipeline("step3_done");
      },
      4: async () => {
        if (!outputs.research_revised) return;
        setPipeline("step4a_running");
        const data = await fetch("/api/pipeline/step4a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: outputs.research_revised }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 4a failed");
        setOutputs(p => ({ ...p, avatar: data.output })); setPipeline("step4a_done");
      },
      5: async () => {
        if (!outputs.research_revised || !outputs.avatar) return;
        setPipeline("step4b_running");
        const data = await fetch("/api/pipeline/step4b", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: outputs.research_revised, avatar: outputs.avatar }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 4b failed");
        setOutputs(p => ({ ...p, offer_brief: data.output })); setPipeline("step4b_done");
      },
      6: async () => {
        if (!outputs.research_revised || !outputs.avatar || !outputs.offer_brief) return;
        setPipeline("step4c_running");
        const data = await fetch("/api/pipeline/step4c", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research: outputs.research_revised, avatar: outputs.avatar, offer_brief: outputs.offer_brief }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 4c failed");
        setOutputs(p => ({ ...p, necessary_beliefs: data.output })); setPipeline("step4c_done");
      },
      7: async () => {
        if (!outputs.research_revised || !outputs.avatar || !outputs.offer_brief || !outputs.necessary_beliefs) return;
        setPipeline("step5_running");
        const data = await fetch("/api/pipeline/step5", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ research_revised: outputs.research_revised, avatar: outputs.avatar, offer_brief: outputs.offer_brief, necessary_beliefs: outputs.necessary_beliefs }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 5 failed");
        setOutputs(p => ({ ...p, chief_final: data.output })); setPipeline("step5_done");
      },
      8: async () => {
        if (!outputs.chief_final || !outputs.avatar || !outputs.offer_brief || !outputs.necessary_beliefs) return;
        setPipeline("step6_running");
        const data = await fetch("/api/pipeline/step6", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chief_final: outputs.chief_final, avatar: outputs.avatar, offer_brief: outputs.offer_brief, necessary_beliefs: outputs.necessary_beliefs }) }).then(r => r.json());
        if (!data.success) throw new Error(data.error ?? "Step 6 failed");
        setOutputs(p => ({ ...p, avatar_revised: data.avatar_revised, offer_brief_revised: data.offer_brief_revised, necessary_beliefs_revised: data.necessary_beliefs_revised }));
        setPipeline("complete");
      },
    };
    try { await handlers[num]?.(); }
    catch (err) { setError(num, err instanceof Error ? err.message : String(err)); }
  }

  function copyText(text: string) { navigator.clipboard.writeText(text).catch(() => {}); }
  function downloadTxt(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = filename; a.click();
    URL.revokeObjectURL(u);
  }

  const selectedMeta = STEP_META[selectedStep - 1];
  const selectedOutput = getStepOutput(selectedStep);
  const selectedState = getStepCardState(pipeline, errorStage, selectedStep);
  const fileSlug = getFileSlug(brandSlug, productSlug);

  // Tab state computations
  const tab1State: "idle" | "running" | "done" =
    isComplete ? "done" :
    (pipeline !== "idle" && pipeline !== "error" && !pipelineIsStage2Running && !pipelineIsStage2Done && !pipelineIsStage3PromptsRunning && !pipelineIsStage3ImagesRunning && !pipelineIsStage3ImagesDone) ? "running" : "idle";
  const tab2State: "idle" | "running" | "done" =
    pipelineIsStage2Done ? "done" : pipelineIsStage2Running ? "running" : "idle";
  const tab3State: "idle" | "running" | "done" =
    pipelineIsStage3ImagesDone ? "done" : (pipelineIsStage3PromptsRunning || pipelineIsStage3ImagesRunning) ? "running" : "idle";
  const tab2Disabled = !isComplete && !pipelineIsStage2Done && !pipelineIsStage2Running;
  const tab3Disabled = !pipelineIsStage2Done && !pipelineIsStage3ImagesDone;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">

      {/* ============ Sticky top bar ============ */}
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-12 flex items-center justify-between gap-4">
          {/* Logo + breadcrumb */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h10M4 18h7" />
              </svg>
            </div>
            <h1 className="text-[13px] font-semibold text-zinc-100 tracking-tight">Pipeline</h1>
            {(brandSlug || productSlug) && (
              <>
                <span className="text-zinc-700 text-[12px]">/</span>
                <span className="text-[12px] font-mono text-zinc-500 truncate max-w-[180px]">{brandSlug || productSlug}</span>
              </>
            )}
          </div>

          {/* Stage tabs */}
          <nav className="flex items-center gap-0.5 bg-zinc-900/80 border border-zinc-800 rounded-lg p-0.5">
            {([
              { num: 1, label: "Research", state: tab1State, disabled: false },
              { num: 2, label: "Copy",     state: tab2State, disabled: tab2Disabled },
              { num: 3, label: "Images",   state: tab3State, disabled: tab3Disabled },
            ] as const).map(t => (
              <button
                key={t.num}
                disabled={t.disabled}
                onClick={() => {
                  if (t.num === 3) {
                    if (runId) window.location.href = `/stage3?runId=${runId}`;
                    return;
                  }
                  setCurrentTab(t.num);
                }}
                className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-all duration-150 ${
                  currentTab === t.num
                    ? "bg-zinc-800 text-zinc-100"
                    : t.disabled
                    ? "text-zinc-700 cursor-not-allowed"
                    : "text-zinc-400 hover:text-zinc-100 cursor-pointer"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    t.state === "done" ? "bg-emerald-500" :
                    t.state === "running" ? "bg-blue-500 animate-pulse" :
                    t.disabled ? "bg-zinc-800" : "bg-zinc-700"
                  }`} />
                  <span className="text-[10px] font-mono text-zinc-600 tabular-nums">{t.num}</span>
                  {t.label}
                </span>
              </button>
            ))}
          </nav>

          {/* Right: status / new-run */}
          <div className="flex items-center gap-3 min-w-[120px] justify-end">
            {isActive && statusLabel && (
              <span className="font-mono text-[10px] text-zinc-500 truncate hidden md:inline">{statusLabel}</span>
            )}
            {!isActive && (isComplete || pipelineIsStage2Done || pipelineIsStage3ImagesDone) && currentTab === 1 && (
              <button
                onClick={() => {
                  setPipeline("idle"); setUrl(""); setProductDescription(""); setCompetitorUrls("");
                  setOutputs(EMPTY_OUTPUTS); setBrandSlug(null); setProductSlug(null);
                  setStage2Output(""); setProductName(""); setImageSlots([]);
                  setCurrentTab(1); setSelectedStep(1); setRunId(null);
                }}
                className="cursor-pointer text-[11px] font-mono text-zinc-500 hover:text-zinc-200 transition-colors active:scale-95"
              >
                + New run
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-6">

        {/* ====================== STAGE 1: RESEARCH ====================== */}
        {currentTab === 1 && (
          <div className="space-y-5 fade-in">

            {/* Input panel — visible only when idle */}
            {!showPipeline && (
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight">New research run</h2>
                  <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">8 steps · ~3-4 min</span>
                </div>
                <div className="border border-zinc-800 rounded-xl bg-zinc-900/30 divide-y divide-zinc-800/70">
                  {/* URL */}
                  <div className="p-4 space-y-1.5">
                    <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Product URL</label>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && canStartPipeline && runPipeline()}
                      placeholder="https://www.aliexpress.com/item/..."
                      disabled={isActive}
                      className="w-full bg-transparent text-[14px] text-zinc-100 placeholder-zinc-700 focus:outline-none disabled:opacity-40"
                    />
                  </div>

                  {/* Description */}
                  <div className="p-4 space-y-1.5">
                    <label className={`block text-[10px] font-mono uppercase tracking-widest transition-colors ${ambiguousListing ? 'text-red-400' : 'text-zinc-500'}`}>
                      Description
                      <span className={`ml-2 normal-case tracking-normal font-sans ${ambiguousListing ? 'text-red-400' : 'text-zinc-700'}`}>
                        {ambiguousListing ? 'required — listing is ambiguous' : 'optional — overrides scraper'}
                      </span>
                    </label>
                    <textarea
                      ref={descriptionRef}
                      value={productDescription}
                      onChange={(e) => { setProductDescription(e.target.value); if (e.target.value.length >= 10) setAmbiguousListing(false); }}
                      rows={2}
                      placeholder="e.g. Children's swimming goggle set, soft silicone, ages 4–10."
                      disabled={isActive}
                      className={`w-full bg-transparent text-[13px] text-zinc-100 placeholder-zinc-700 focus:outline-none disabled:opacity-40 resize-none ${ambiguousListing ? 'animate-pulse' : ''}`}
                    />
                  </div>

                  {/* Competitors */}
                  <details className="group">
                    <summary className="px-4 py-3 cursor-pointer select-none list-none flex items-center gap-2 hover:bg-zinc-900/40 transition-colors">
                      <span className="text-[9px] text-zinc-600 group-open:rotate-90 transition-transform inline-block">▶</span>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Competitor URLs</span>
                      <span className="text-[10px] font-mono text-zinc-700">optional</span>
                    </summary>
                    <div className="px-4 pb-4">
                      <textarea
                        value={competitorUrls}
                        onChange={(e) => setCompetitorUrls(e.target.value)}
                        placeholder="One URL per line"
                        rows={2}
                        disabled={isActive}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2 text-[12px] font-mono text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-700 transition-colors resize-none"
                      />
                    </div>
                  </details>

                  {/* Run row */}
                  <div className="p-4 flex items-center justify-between gap-3">
                    <button
                      onClick={runPipeline}
                      disabled={!canStartPipeline || isActive}
                      className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white font-medium text-[13px] rounded-md transition-all duration-150 flex items-center gap-2"
                    >
                      Run Pipeline
                      <kbd className="text-[10px] font-mono bg-blue-700/60 px-1 py-0.5 rounded">↵</kbd>
                    </button>
                    <span className="text-[11px] text-zinc-600 hidden sm:inline">Generates research + 6 strategy docs</span>
                  </div>
                </div>

                {ambiguousListing && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-900/50">
                    <span className="text-red-400 text-sm mt-px flex-shrink-0">!</span>
                    <p className="font-mono text-[11px] text-red-400 leading-relaxed">
                      The product listing doesn&apos;t have enough clear information. Please describe the product in the field above.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Pipeline view — visible when running or done */}
            {showPipeline && (
              <>
                {/* Run summary */}
                <section className="border border-zinc-800 rounded-xl bg-zinc-900/30 p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">URL</span>
                      {brandSlug && <span className="text-[11px] font-mono text-emerald-400">· {brandSlug}</span>}
                    </div>
                    <div className="text-[12px] font-mono text-zinc-300 truncate">{url}</div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${
                      isComplete ? "text-emerald-400" : errorStage !== null ? "text-red-400" : "text-blue-400"
                    }`}>
                      {isComplete ? "Complete" : errorStage !== null ? "Error" : "Running"}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500 tabular-nums">{stepsCompleted} of 8</span>
                  </div>
                </section>

                {/* Stepper */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="hidden sm:grid grid-cols-3 gap-1.5 flex-1 max-w-md">
                      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.15em]">Research</span>
                      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.15em] text-center">Strategy</span>
                      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.15em] text-right">Review</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-600 tabular-nums">{Math.round((stepsCompleted/8) * 100)}%</span>
                  </div>
                  <div className="grid grid-cols-8 gap-1.5">
                    {STEP_META.map(m => {
                      const s = getStepCardState(pipeline, errorStage, m.num);
                      const isSel = selectedStep === m.num;
                      return (
                        <button
                          key={m.num}
                          onClick={() => setSelectedStep(m.num)}
                          className={`relative rounded-md p-2 text-left transition-all duration-150 cursor-pointer ${
                            isSel
                              ? "bg-zinc-800 ring-1 ring-blue-500/50"
                              : "bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-900"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${
                              s === "error" ? "bg-red-500" :
                              s === "running" ? "bg-blue-500 animate-pulse" :
                              s === "complete" ? "bg-emerald-500" :
                              "bg-zinc-700"
                            }`} />
                            <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{m.num.toString().padStart(2, "0")}</span>
                          </div>
                          <div className={`text-[11px] font-medium leading-tight truncate ${
                            s === "locked" ? "text-zinc-600" : "text-zinc-200"
                          }`}>{m.short}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Master-detail panel */}
                <section className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30">
                  <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">

                    {/* Master: phase-grouped list */}
                    <div className="overflow-y-auto max-h-[640px]">
                      {(["Research", "Strategy", "Review"] as const).map(phase => (
                        <div key={phase}>
                          <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-800/60">
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.14em]">{phase}</span>
                          </div>
                          {STEP_META.filter(m => m.phase === phase).map(m => {
                            const s = getStepCardState(pipeline, errorStage, m.num);
                            const isSel = selectedStep === m.num;
                            return (
                              <button
                                key={m.num}
                                onClick={() => setSelectedStep(m.num)}
                                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-zinc-800/40 last:border-b-0 transition-colors cursor-pointer ${
                                  isSel ? "bg-blue-500/[0.07]" : "hover:bg-zinc-900/60"
                                }`}
                              >
                                <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-mono flex-shrink-0 ${
                                  s === "error" ? "bg-red-500/10 text-red-400 border border-red-500/30" :
                                  s === "running" ? "bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse" :
                                  s === "complete" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" :
                                  "bg-zinc-900 text-zinc-600 border border-zinc-800"
                                }`}>
                                  {s === "complete" ? "✓" : s === "error" ? "!" : m.num}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-[12px] font-medium truncate ${
                                    isSel ? "text-zinc-100" : s === "locked" ? "text-zinc-600" : "text-zinc-300"
                                  }`}>{m.short}</div>
                                </div>
                                {s === "running" && <span className="text-[8px] font-mono text-blue-400 animate-pulse">●</span>}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Detail: selected step */}
                    <div className="min-h-[400px] flex flex-col">
                      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-mono flex-shrink-0 ${
                            selectedState === "error" ? "bg-red-500/10 text-red-400 border border-red-500/30" :
                            selectedState === "running" ? "bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse" :
                            selectedState === "complete" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" :
                            "bg-zinc-900 text-zinc-600 border border-zinc-800"
                          }`}>
                            {selectedState === "complete" ? "✓" : selectedState === "error" ? "!" : selectedStep}
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-zinc-100 truncate">{selectedMeta.title}</div>
                            <div className="text-[11px] text-zinc-500 truncate">{selectedMeta.desc}</div>
                          </div>
                        </div>
                        {selectedOutput && selectedState === "complete" && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => copyText(selectedOutput)}
                              className="cursor-pointer px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-100 rounded-md text-[11px] font-mono transition-colors active:scale-95"
                            >Copy</button>
                            <button
                              onClick={() => downloadTxt(`${fileSlug}_${filenameMap[selectedStep]}`, selectedOutput)}
                              className="cursor-pointer px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-100 rounded-md text-[11px] font-mono transition-colors active:scale-95"
                            >↓ .txt</button>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 p-4">
                        {selectedState === "locked" && (
                          <div className="h-full flex items-center justify-center min-h-[320px]">
                            <div className="text-center space-y-1.5">
                              <div className="text-[12px] font-mono text-zinc-600">Step not started</div>
                              <div className="text-[11px] text-zinc-700">Waiting for previous steps</div>
                            </div>
                          </div>
                        )}
                        {selectedState === "running" && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                              <span className="text-[12px] font-mono text-blue-400">{statusLabel || "Running…"}</span>
                            </div>
                            <div className="space-y-1.5">
                              {[100, 92, 96, 88, 70, 95, 60].map((w, i) => (
                                <div key={i} className="h-2.5 bg-zinc-800/60 rounded animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }} />
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedState === "error" && (
                          <div className="space-y-3">
                            <div className="px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-900/50">
                              <p className="text-[12px] text-red-400 font-mono leading-relaxed">{errorMessage}</p>
                            </div>
                            <button
                              onClick={() => retryStep(selectedStep)}
                              className="cursor-pointer px-3 py-1.5 border border-red-900/50 text-red-400 hover:bg-red-950/40 rounded-md text-[12px] transition-colors active:scale-95"
                            >Retry step {selectedStep}</button>
                          </div>
                        )}
                        {selectedState === "complete" && selectedOutput && (
                          <pre className="text-[11.5px] font-mono text-zinc-300 whitespace-pre-wrap break-words leading-relaxed max-h-[520px] overflow-y-auto fade-in">{selectedOutput}</pre>
                        )}
                        {selectedState === "complete" && !selectedOutput && (
                          <div className="h-full flex items-center justify-center min-h-[320px]">
                            <div className="text-[12px] font-mono text-zinc-600">Skipped — no changes required</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Footer actions */}
                {isComplete && (
                  <section className="flex flex-wrap items-center gap-3 fade-in">
                    <button
                      onClick={() => setCurrentTab(2)}
                      className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium text-[13px] rounded-md transition-all duration-150"
                    >Continue to Stage 2 →</button>
                    <button
                      onClick={downloadAll}
                      className="cursor-pointer px-4 py-2 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-100 rounded-md font-mono text-[12px] transition-colors active:scale-95"
                    >↓ Download All (.zip)</button>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* ====================== STAGE 2: COPY ====================== */}
        {currentTab === 2 && (
          <div className="space-y-5 fade-in">
            <section>
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight">German copy generation</h2>
                <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Stage 2 of 3</span>
              </div>
              <p className="text-[12px] text-zinc-500">Product names, headlines, benefits, FAQs, Facebook copy, one-liners — generated using the Stage 1 research.</p>
            </section>

            <section className="border border-zinc-800 rounded-xl bg-zinc-900/30 overflow-hidden divide-y divide-zinc-800/70">
              <div className="p-4 space-y-1.5">
                <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Brand / product name</label>
                <input
                  ref={productNameRef}
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canRunStage2 && runStage2()}
                  placeholder="e.g. WELLENFROH"
                  disabled={pipelineIsStage2Running}
                  className="w-full bg-transparent text-[14px] text-zinc-100 placeholder-zinc-700 focus:outline-none disabled:opacity-40"
                />
                <p className="text-[10px] text-zinc-600 font-mono">Used in all generated copy · pre-filled from Stage 1 suggestions</p>
              </div>

              <div className="p-4 flex items-center gap-3">
                <button
                  onClick={runStage2}
                  disabled={!canRunStage2 || pipelineIsStage2Running}
                  className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white font-medium text-[13px] rounded-md transition-all duration-150"
                >
                  {pipelineIsStage2Running ? "Generating…" : stage2Output ? "Re-generate" : "Generate Copy"}
                </button>
                {pipelineIsStage2Running && (
                  <span className="flex items-center gap-2 text-[11px] font-mono text-blue-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Generating German copy kit…
                  </span>
                )}
                {!productName.trim() && !pipelineIsStage2Running && !stage2Output && (
                  <span className="text-[11px] font-mono text-amber-500/80">Enter a brand name to enable</span>
                )}
              </div>

              {errorStage === 12 && (
                <div className="p-4">
                  <div className="px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-900/50">
                    <p className="text-[12px] text-red-400 font-mono">{errorMessage}</p>
                  </div>
                </div>
              )}

              {stage2Output && !pipelineIsStage2Running && (
                <div className="p-4 space-y-3 fade-in">
                  <OutputBlock text={stage2Output} />
                  <FeedbackBar runId={runId} stage={2} />
                </div>
              )}
            </section>

            {pipelineIsStage2Done && (
              <section className="border border-emerald-900/40 rounded-xl bg-emerald-950/20 p-4 flex flex-wrap items-center justify-between gap-3 fade-in">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 flex items-center justify-center rounded bg-emerald-500/10 border border-emerald-500/30 text-[9px] text-emerald-400">✓</span>
                  <div>
                    <div className="text-[13px] font-medium text-emerald-400">Stage 2 complete</div>
                    <div className="text-[11px] text-zinc-500">German copy kit ready · continue to image generation</div>
                  </div>
                </div>
                {runId ? (
                  <a
                    href={`/stage3?runId=${runId}`}
                    className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium text-[13px] rounded-md transition-all duration-150"
                  >Continue to Stage 3 →</a>
                ) : (
                  <span className="text-[11px] font-mono text-zinc-500 animate-pulse">Saving run…</span>
                )}
              </section>
            )}
          </div>
        )}

      </div>

    </main>
  );

}
