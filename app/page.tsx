"use client";

import { useState, useRef } from "react";
import StageCard from "@/components/StageCard";
import OutputBlock from "@/components/OutputBlock";
import ImageUploader from "@/components/ImageUploader";
import ImageGrid from "@/components/ImageGrid";
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
    <div className={`border-b border-zinc-800 last:border-b-0 py-4 px-4 transition-all duration-150 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}>
      {/* Row header */}
      <div className="flex items-center gap-3">
        <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono flex-shrink-0 select-none ${badgeCls} ${isRunning ? "animate-pulse" : ""}`}>
          {isComplete ? "✓" : isError ? "!" : stepNum}
        </span>
        <span className={`font-mono text-[13px] flex-1 leading-none ${
          isRunning || isComplete ? "text-zinc-100" : "text-zinc-600"
        }`}>
          {title}
        </span>
        {isRunning && (
          <span className="text-[10px] font-mono text-blue-400 animate-pulse">running</span>
        )}
        {isComplete && !isRunning && (
          <span className="text-[10px] font-mono text-zinc-600">
            {skipped ? "skipped" : "done"}
          </span>
        )}
        {isError && (
          <span className="text-[10px] font-mono text-red-400">error</span>
        )}
      </div>

      {/* Description — shown when not locked */}
      {!isLocked && (
        <p className="text-[11px] text-zinc-600 font-mono mt-0.5 pl-8">{description}</p>
      )}

      {/* Error state */}
      {isError && (
        <div className="mt-3 pl-8 space-y-2">
          <p className="text-[11px] text-red-400 font-mono">{errorMessage}</p>
          <button
            onClick={onRetry}
            className="cursor-pointer px-3 py-1.5 border border-red-900/50 text-red-400 hover:bg-red-950/40 rounded-lg text-xs transition-colors"
          >
            Retry step {stepNum}
          </button>
        </div>
      )}

      {/* Output */}
      {isComplete && output && (
        <div className="mt-3 pl-8 space-y-2">
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
            {output}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyToClipboard(output)}
              className="cursor-pointer px-3 py-1.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-[11px] font-mono transition-colors"
            >
              Copy
            </button>
            <button
              onClick={() => downloadTxt(`${slug}_${filenameMap[stepNum] ?? `step${stepNum}.txt`}`, output)}
              className="cursor-pointer px-3 py-1.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg text-[11px] font-mono transition-colors"
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

function imageStageCardState(
  pipeline: string,
  errorStage: number | null,
  stageNum: number
): "locked" | "running" | "complete" | "error" {
  if (errorStage === stageNum + 10) return "error";
  if (stageNum === 2) {
    if (pipeline === "stage2_running") return "running";
    if (["stage2_done", "stage3_prompts_running", "stage3_prompts_done", "stage3_images_running", "stage3_images_done"].includes(pipeline)) return "complete";
    return "locked";
  }
  if (stageNum === 3) {
    if (pipeline === "stage3_prompts_running" || pipeline === "stage3_images_running") return "running";
    if (pipeline === "stage3_images_done") return "complete";
    return "locked";
  }
  return "locked";
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

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

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
    // Step 1: Find "Brand Name Options" section specifically, then grab the first bullet item
    const optionsMatch = offerBriefText.match(
      /brand name[^\n]*?options?[^\n]*\n([\s\S]{0,600}?)(?=\n\n\d\.|\n\n\*\*\d\.|\n\n##|$)/i
    );
    if (optionsMatch) {
      const block = optionsMatch[1];
      // Find first line that starts with a bullet (- or *)
      const bulletLine = block.split("\n").find(l => /^[-*]\s+\S/.test(l));
      if (bulletLine) {
        const name = bulletLine
          .replace(/^[-*]\s+/, "")       // strip bullet character
          .replace(/\*\*/g, "")           // strip markdown bold markers
          .split(/\s*[-–(]/)[0]           // stop at dash/paren qualifiers like "- recommended"
          .trim();
        if (name.length > 0 && name.length < 60) return toSlug(name) || null;
      }
    }
    // Step 2: Broader fallback — any "brand name" or "product name" section, first bullet
    const sectionMatch = offerBriefText.match(/(?:product name|brand name)[^\n]*\n([\s\S]{0,600}?)(?:\n\n|\n\d\.|\n##)/i);
    if (!sectionMatch) return null;
    const block = sectionMatch[1];
    const bulletLine = block.split("\n").find(l => /^[-*]\s+\S/.test(l));
    if (bulletLine) {
      const name = bulletLine
        .replace(/^[-*]\s+/, "")
        .replace(/\*\*/g, "")
        .split(/\s*[-–(]/)[0]
        .trim();
      if (name.length > 0 && name.length < 60) return toSlug(name) || null;
    }
    // Step 3: Last resort — first non-empty, non-header line
    const firstLine = block.split("\n")
      .map(l => l.replace(/^[-*\d.*\s#]+/, "").trim())
      .find(l => l.length > 0 && l.length < 60 && !l.includes(":"));
    return firstLine ? toSlug(firstLine) || null : null;
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

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-5 pt-10 pb-20">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] text-blue-400 uppercase tracking-widest">Stage 1</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">Research</span>
          </div>
          <p className="text-zinc-500 text-sm">Paste a product URL to generate research, avatars, and copy briefs.</p>
        </div>

        {/* Inputs */}
        <div className="space-y-5 mb-8">
          <div>
            <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
              Product URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canStartPipeline && runPipeline()}
              placeholder="https://www.aliexpress.com/item/..."
              disabled={isActive}
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors disabled:opacity-40"
            />
          </div>

          <div>
            <label className={`block font-mono text-[10px] uppercase tracking-widest mb-2 transition-colors duration-150 ${ambiguousListing ? 'text-red-400' : 'text-zinc-500'}`}>
              Product Description
              {ambiguousListing ? (
                <span className="ml-2 normal-case tracking-normal text-red-400 font-sans font-normal">required — listing is ambiguous</span>
              ) : (
                <span className="text-zinc-600 tracking-normal normal-case ml-2">optional — overrides scraper</span>
              )}
            </label>
            <textarea
              ref={descriptionRef}
              value={productDescription}
              onChange={(e) => {
                setProductDescription(e.target.value);
                if (e.target.value.length >= 10) setAmbiguousListing(false);
              }}
              rows={3}
              placeholder="e.g. Children's swimming goggle set, soft silicone, ages 4–10. Use when the listing is in another language or unclear."
              disabled={isActive}
              className={`w-full bg-zinc-900 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-all duration-150 disabled:opacity-40 resize-none ${
                ambiguousListing
                  ? 'border-2 border-red-500 focus:border-red-400 ring-2 ring-red-500/20 animate-pulse'
                  : 'border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10'
              }`}
            />
          </div>

          <details className="group">
            <summary className="cursor-pointer font-mono text-[11px] text-zinc-600 hover:text-zinc-400 select-none list-none flex items-center gap-1.5">
              <span className="text-[9px] group-open:rotate-90 transition-transform duration-150 inline-block">▶</span>
              Competitor URLs
              <span className="text-zinc-700 ml-1">optional</span>
            </summary>
            <div className="mt-2">
              <textarea
                value={competitorUrls}
                onChange={(e) => setCompetitorUrls(e.target.value)}
                placeholder="One URL per line"
                rows={3}
                disabled={isActive}
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors disabled:opacity-40 resize-none"
              />
            </div>
          </details>
        </div>

        {/* CTA + status */}
        <div className="space-y-3 mb-10">
          <div className="flex items-center gap-4">
            <button
              onClick={runPipeline}
              disabled={!canStartPipeline || isActive}
              className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white font-mono text-sm rounded-lg transition-colors duration-150"
            >
              {isActive ? "Running…" : "Run Pipeline"}
            </button>

            {isActive && statusLabel && (
              <span className="font-mono text-[11px] text-zinc-500 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                {statusLabel}
              </span>
            )}

            {isComplete && !isActive && (
              <span className="font-mono text-[11px] text-emerald-400">Complete</span>
            )}
          </div>

          {/* Ambiguous listing warning */}
          {ambiguousListing && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-900/50">
              <span className="text-red-400 text-sm mt-px flex-shrink-0">!</span>
              <p className="font-mono text-[11px] text-red-400 leading-relaxed">
                The product listing doesn&apos;t have enough clear information. Please describe the product in the field above.
              </p>
            </div>
          )}
        </div>

        {showPipeline && (
          <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y-0 bg-zinc-900/20">
            <ResearchStepCard
              stepNum={1}
              title="Step 1 — Research"
              description="Deep market research document for the German DTC market"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.research}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={runPipeline}
            />

            <ResearchStepCard
              stepNum={2}
              title="Step 2 — Mid Chief Review"
              description="Senior editor review of the research document"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.chief_mid}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={() => {
                // Retry from step 2 — need research
                if (!outputs.research) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step2_running");
                fetch("/api/pipeline/step2", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ research: outputs.research }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 2 failed");
                    setOutputs((prev) => ({ ...prev, chief_mid: data.output }));
                    setPipeline("step2_done");
                  })
                  .catch((err) => setError(2, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={3}
              title="Step 3 — Research (Revised)"
              description="Research revised based on chief review"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.research_revised}
              slug={getFileSlug(brandSlug, productSlug)}
              skipped={outputs.chief_mid?.includes("NO REVISIONS REQUIRED") ?? false}
              onRetry={() => {
                if (!outputs.research || !outputs.chief_mid) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step3_running");
                fetch("/api/pipeline/step3", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ research: outputs.research, chief_mid: outputs.chief_mid }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 3 failed");
                    setOutputs((prev) => ({ ...prev, research_revised: data.output }));
                    setPipeline("step3_done");
                  })
                  .catch((err) => setError(3, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={4}
              title="Step 4a — Avatar"
              description="Ideal customer avatar for the German market"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.avatar}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={() => {
                if (!outputs.research_revised) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step4a_running");
                fetch("/api/pipeline/step4a", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ research: outputs.research_revised }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 4a failed");
                    setOutputs((prev) => ({ ...prev, avatar: data.output }));
                    setPipeline("step4a_done");
                  })
                  .catch((err) => setError(4, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={5}
              title="Step 4b — Offer Brief"
              description="Offer strategy grounded in research and avatar"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.offer_brief}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={() => {
                if (!outputs.research_revised || !outputs.avatar) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step4b_running");
                fetch("/api/pipeline/step4b", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ research: outputs.research_revised, avatar: outputs.avatar }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 4b failed");
                    setOutputs((prev) => ({ ...prev, offer_brief: data.output }));
                    setPipeline("step4b_done");
                  })
                  .catch((err) => setError(5, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={6}
              title="Step 4c — Necessary Beliefs"
              description="6 beliefs the German prospect must hold before buying"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.necessary_beliefs}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={() => {
                if (!outputs.research_revised || !outputs.avatar || !outputs.offer_brief) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step4c_running");
                fetch("/api/pipeline/step4c", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    research: outputs.research_revised,
                    avatar: outputs.avatar,
                    offer_brief: outputs.offer_brief,
                  }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 4c failed");
                    setOutputs((prev) => ({ ...prev, necessary_beliefs: data.output }));
                    setPipeline("step4c_done");
                  })
                  .catch((err) => setError(6, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={7}
              title="Step 5 — Final Chief Review"
              description="Cross-document consistency and argument soundness review"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.chief_final}
              slug={getFileSlug(brandSlug, productSlug)}
              onRetry={() => {
                if (!outputs.research_revised || !outputs.avatar || !outputs.offer_brief || !outputs.necessary_beliefs) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step5_running");
                fetch("/api/pipeline/step5", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    research_revised: outputs.research_revised,
                    avatar: outputs.avatar,
                    offer_brief: outputs.offer_brief,
                    necessary_beliefs: outputs.necessary_beliefs,
                  }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 5 failed");
                    setOutputs((prev) => ({ ...prev, chief_final: data.output }));
                    setPipeline("step5_done");
                  })
                  .catch((err) => setError(7, err instanceof Error ? err.message : String(err)));
              }}
            />

            <ResearchStepCard
              stepNum={8}
              title="Step 6 — Final Revisions"
              description="Documents revised based on final chief review"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              slug={getFileSlug(brandSlug, productSlug)}
              output={
                outputs.avatar_revised
                  ? [
                      "=== AVATAR.txt (revised) ===",
                      outputs.avatar_revised,
                      "\n=== OFFER_BRIEF.txt (revised) ===",
                      outputs.offer_brief_revised ?? "",
                      "\n=== NECESSARY_BELIEFS.txt (revised) ===",
                      outputs.necessary_beliefs_revised ?? "",
                    ].join("\n\n")
                  : null
              }
              skipped={step6Skipped}
              onRetry={() => {
                if (!outputs.chief_final || !outputs.avatar || !outputs.offer_brief || !outputs.necessary_beliefs) return;
                setErrorStage(null);
                setErrorMessage("");
                setPipeline("step6_running");
                fetch("/api/pipeline/step6", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chief_final: outputs.chief_final,
                    avatar: outputs.avatar,
                    offer_brief: outputs.offer_brief,
                    necessary_beliefs: outputs.necessary_beliefs,
                  }),
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!data.success) throw new Error(data.error ?? "Step 6 failed");
                    setOutputs((prev) => ({
                      ...prev,
                      avatar_revised: data.avatar_revised,
                      offer_brief_revised: data.offer_brief_revised,
                      necessary_beliefs_revised: data.necessary_beliefs_revised,
                    }));
                    setPipeline("complete");
                  })
                  .catch((err) => setError(8, err instanceof Error ? err.message : String(err)));
              }}
            />

            {(isComplete || pipelineIsStage2Running || pipelineIsStage2Done || pipelineIsStage3PromptsRunning || pipelineIsStage3ImagesRunning || pipelineIsStage3ImagesDone) && outputs.research_revised && (
              <div className="px-4 py-3 border-t border-zinc-800">
                <button
                  onClick={downloadAll}
                  className="cursor-pointer px-4 py-2 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 rounded-lg font-mono text-[11px] transition-colors duration-150"
                >
                  ↓ Download All (.zip)
                </button>
              </div>
            )}

            {/* Image generation stage (kept from original) */}
            {(isComplete || pipelineIsStage2Running || pipelineIsStage2Done || pipelineIsStage3PromptsRunning || pipelineIsStage3ImagesRunning || pipelineIsStage3ImagesDone) && (
              <div className="mt-6 border-t border-zinc-800 pt-6 px-4">
                <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest mb-4">
                  Image Generation — Optional
                </p>

                <div className="space-y-3">
                  <StageCard
                    number={2}
                    title="Stage 2 — German Copy"
                    description="Product names, headlines, benefits, FAQs, Facebook copy, one-liners"
                    state={imageStageCardState(pipeline, errorStage, 2)}
                  >
                    {pipelineIsStage2Running && (
                      <p className="text-[11px] text-blue-400 font-mono animate-pulse">Generating German copy kit…</p>
                    )}

                    {errorStage === 12 && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-red-400 font-mono">{errorMessage}</p>
                        <button
                          onClick={runStage2}
                          className="cursor-pointer px-3 py-1.5 border border-red-900/50 text-red-400 hover:bg-red-950/40 rounded-lg text-xs transition-colors"
                        >
                          Retry Stage 2
                        </button>
                      </div>
                    )}

                    {stage2Output && !pipelineIsStage2Running && (
                      <div className="space-y-3">
                        <OutputBlock text={stage2Output} />
                        <FeedbackBar runId={runId} stage={2} />
                        {pipelineIsStage2Done && (
                          <div className="space-y-3 pt-1 border-t border-zinc-800 mt-3">
                            {showImageUploader && allImages.length < 2 && (
                              <div>
                                <p className="text-amber-400 text-xs font-mono mb-2">
                                  Add at least 2 reference images before Stage 3:
                                </p>
                                <ImageUploader
                                  images={userImages}
                                  onImagesChange={setUserImages}
                                  minImages={2}
                                />
                              </div>
                            )}
                            <button
                              onClick={runStage3}
                              disabled={!canRunStage3}
                              className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg font-mono text-sm transition-colors duration-150"
                            >
                              Continue to Stage 3 →
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {pipeline === "complete" && !stage2Output && (
                      <div className="space-y-3">
                        {showImageUploader && (
                          <div>
                            <p className="text-amber-400 text-xs font-mono mb-2">
                              Add reference images for Stage 3:
                            </p>
                            <ImageUploader
                              images={userImages}
                              onImagesChange={setUserImages}
                              minImages={2}
                            />
                          </div>
                        )}
                        <div>
                          <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                            Working product name
                          </label>
                          <input
                            type="text"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && canRunStage2 && runStage2()}
                            placeholder="e.g. WELLENFROH"
                            className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500/10 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors disabled:opacity-40"
                          />
                        </div>
                        <button
                          onClick={runStage2}
                          disabled={!canRunStage2}
                          className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-lg font-mono text-sm transition-colors duration-150"
                        >
                          Run Stage 2 (German Copy) →
                        </button>
                      </div>
                    )}
                  </StageCard>

                  <StageCard
                    number={3}
                    title="Stage 3 — Image Generation"
                    description="11 Higgsfield prompts with QC gate, audit loop, and feedback learning"
                    state={imageStageCardState(pipeline, errorStage, 3)}
                  >
                    {/* Stage 3 entry point — navigates to /stage3 page */}
                    {(pipelineIsStage2Done || pipelineIsStage3PromptsRunning || pipelineIsStage3ImagesRunning || pipelineIsStage3ImagesDone) && runId && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-zinc-500 font-mono">
                          Stage 2 complete. Ready to generate product images.
                        </p>
                        <a
                          href={`/stage3?runId=${runId}`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                        >
                          Open Image Generation →
                        </a>
                      </div>
                    )}
                    {pipelineIsStage3ImagesDone && (
                      <p className="text-[11px] text-emerald-400 font-mono">Images generated.</p>
                    )}
                  </StageCard>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );

}
