"use client";

import { useState } from "react";
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

  return (
    <div
      className={`border rounded-lg p-4 space-y-3 transition-colors ${
        isError
          ? "border-[#dc2626] bg-[#0f0f0f]"
          : isRunning
          ? "border-[#2563eb] bg-[#0a0f1e]"
          : isComplete
          ? "border-[#1a3a2a] bg-[#0a0f0a]"
          : "border-[#1a1a1a] bg-[#0a0a0a] opacity-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-mono px-1.5 py-0.5 rounded ${
            isError
              ? "bg-[#dc2626] text-white"
              : isRunning
              ? "bg-[#2563eb] text-white"
              : isComplete
              ? "bg-[#16a34a] text-white"
              : "bg-[#1a1a1a] text-[#404040]"
          }`}
        >
          {stepNum}
        </span>
        <span className="text-sm font-mono text-[#e5e5e5]">{title}</span>
        {isRunning && (
          <span className="text-xs font-mono text-[#2563eb] animate-pulse ml-auto">
            Running...
          </span>
        )}
        {isComplete && !isRunning && (
          <span className="text-xs font-mono text-[#16a34a] ml-auto">
            {skipped ? "Skipped (no revisions needed)" : "Done"}
          </span>
        )}
      </div>

      <p className="text-xs text-[#404040] font-mono">{description}</p>

      {isError && (
        <div className="space-y-2">
          <p className="text-xs text-[#dc2626] font-mono">Error: {errorMessage}</p>
          <button
            onClick={onRetry}
            className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
          >
            Retry Step {stepNum}
          </button>
        </div>
      )}

      {isComplete && output && (
        <div className="space-y-2">
          <div
            className="bg-[#111] border border-[#1a1a1a] rounded p-3 overflow-y-auto"
            style={{ maxHeight: "400px" }}
          >
            <pre className="text-xs font-mono text-[#a0a0a0] whitespace-pre-wrap break-words">
              {output}
            </pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyToClipboard(output)}
              className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
            >
              Copy
            </button>
            <button
              onClick={() => downloadTxt(filenameMap[stepNum] ?? `step${stepNum}.txt`, output)}
              className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
            >
              Download .txt
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

  // Image generation state (kept from original)
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [userImages, setUserImages] = useState<string[]>([]);
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [productName, setProductName] = useState("");
  const [stage2Output, setStage2Output] = useState("");
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const allImages = [...scrapedImages, ...userImages];

  function setError(stage: number, msg: string) {
    setErrorStage(stage);
    setErrorMessage(msg);
    setPipeline("error");
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

    const competitorList = competitorUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    // Scrape
    setPipeline("scraping");
    const { scraped, competitorScraped } = await scrapeAll();

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
      setOutputs((prev) => ({ ...prev, offer_brief: data.output }));
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
      setOutputs((prev) => ({
        ...prev,
        avatar_revised: data.avatar_revised,
        offer_brief_revised: data.offer_brief_revised,
        necessary_beliefs_revised: data.necessary_beliefs_revised,
      }));
      setPipeline("complete");
    } catch (err) {
      setError(8, err instanceof Error ? err.message : String(err));
      return;
    }
  }

  async function downloadAll() {
    const zip = new JSZip();
    zip.file("RESEARCH.txt", outputs.research_revised ?? "");
    zip.file("AVATAR.txt", outputs.avatar_revised ?? "");
    zip.file("OFFER_BRIEF.txt", outputs.offer_brief_revised ?? "");
    zip.file("NECESSARY_BELIEFS.txt", outputs.necessary_beliefs_revised ?? "");
    zip.file("CHIEF_MID.txt", outputs.chief_mid ?? "");
    zip.file("CHIEF_FINAL.txt", outputs.chief_final ?? "");
    const blob = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "pipeline-docs.zip";
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
      const saveRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: url.trim(),
          product_name: productName,
          stage1_output: outputs.research_revised ?? outputs.research ?? "",
          stage2_output: stage2Output,
          stage3_prompts: prompts,
          image_urls: imageUrls,
        }),
      });
      const saveData = await saveRes.json();
      if (saveData.id) setRunId(Number(saveData.id));
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

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-7">
          <p className="text-[#404040] text-sm">
            Enter a product URL to run the 8-step Mark Builds Brands research pipeline for the
            German DTC market.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <div>
            <label className="block text-xs font-mono text-[#737373] uppercase tracking-wider mb-1.5">
              Product URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canStartPipeline && runPipeline()}
              placeholder="https://www.aliexpress.com/item/..."
              disabled={isActive}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2.5 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb] disabled:opacity-40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-[#737373] uppercase tracking-wider mb-1.5">
              Product Description <span className="normal-case text-[#333]">(optional)</span>
            </label>
            <p className="text-xs text-[#333] mb-1.5">
              Describe what the product actually is. Use this when the listing is unclear or in a language Claude may misread. This overrides the scraper's product identification.
            </p>
            <textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={4}
              placeholder="e.g. Children's swimming goggle set including goggles, swim cap, and nose clip. Made from soft silicone. Target ages 4-10."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb] resize-none transition-colors"
            />
          </div>

          <details className="group">
            <summary className="cursor-pointer text-xs font-mono text-[#404040] hover:text-[#737373] transition-colors select-none list-none">
              ↳ Competitor URLs (optional)
            </summary>
            <div className="mt-2">
              <textarea
                value={competitorUrls}
                onChange={(e) => setCompetitorUrls(e.target.value)}
                placeholder="One competitor URL per line..."
                rows={3}
                disabled={isActive}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb] disabled:opacity-40 resize-none transition-colors"
              />
            </div>
          </details>
        </div>

        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={runPipeline}
            disabled={!canStartPipeline || isActive}
            className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
          >
            {pipeline === "scraping"
              ? "Scraping..."
              : isActive
              ? "Running..."
              : "Start Pipeline"}
          </button>

          {isActive && (
            <span className="text-xs font-mono text-[#737373] flex items-center gap-1.5">
              <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-[#737373] inline-block" />
              {pipeline === "scraping"
                ? "Fetching product page..."
                : pipeline === "step1_running"
                ? "Generating research..."
                : pipeline === "step2_running"
                ? "Running mid chief review..."
                : pipeline === "step3_running"
                ? "Revising research..."
                : pipeline === "step4a_running"
                ? "Building avatar..."
                : pipeline === "step4b_running"
                ? "Writing offer brief..."
                : pipeline === "step4c_running"
                ? "Identifying necessary beliefs..."
                : pipeline === "step5_running"
                ? "Running final chief review..."
                : pipeline === "step6_running"
                ? "Applying final revisions..."
                : "Processing..."}
            </span>
          )}
        </div>

        {showPipeline && (
          <div className="space-y-3">
            <ResearchStepCard
              stepNum={1}
              title="Step 1 — Research"
              description="Deep market research document for the German DTC market"
              pipeline={pipeline}
              errorStage={errorStage}
              errorMessage={errorMessage}
              output={outputs.research}
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
              <div className="pt-2">
                <button
                  onClick={downloadAll}
                  className="px-4 py-2 bg-[#16a34a] hover:bg-[#15803d] text-white rounded font-mono text-sm transition-colors"
                >
                  Download All (.zip)
                </button>
              </div>
            )}

            {/* Image generation stage (kept from original) */}
            {(isComplete || pipelineIsStage2Running || pipelineIsStage2Done || pipelineIsStage3PromptsRunning || pipelineIsStage3ImagesRunning || pipelineIsStage3ImagesDone) && (
              <div className="mt-8 border-t border-[#1a1a1a] pt-6">
                <p className="text-xs font-mono text-[#737373] uppercase tracking-wider mb-4">
                  Image Generation (Optional)
                </p>

                <div className="space-y-3">
                  <StageCard
                    number={2}
                    title="Stage 2 — German Copy"
                    description="Product names, headlines, benefits, FAQs, Facebook copy, one-liners"
                    state={imageStageCardState(pipeline, errorStage, 2)}
                  >
                    {pipelineIsStage2Running && (
                      <p className="text-xs text-[#404040] font-mono">Generating German copy kit...</p>
                    )}

                    {errorStage === 12 && (
                      <div className="space-y-2">
                        <p className="text-xs text-[#dc2626] font-mono">Error: {errorMessage}</p>
                        <button
                          onClick={runStage2}
                          className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
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
                          <div className="space-y-3 pt-1 border-t border-[#1a1a1a] mt-3">
                            {showImageUploader && allImages.length < 2 && (
                              <div>
                                <p className="text-xs font-mono text-[#b45309] mb-2">
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
                              className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
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
                            <p className="text-xs font-mono text-[#b45309] mb-2">
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
                          <label className="block text-xs font-mono text-[#737373] uppercase tracking-wider mb-1.5">
                            Working product name
                          </label>
                          <input
                            type="text"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && canRunStage2 && runStage2()}
                            placeholder="e.g. WELLENFROH"
                            className="w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb]"
                          />
                        </div>
                        <button
                          onClick={runStage2}
                          disabled={!canRunStage2}
                          className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
                        >
                          Run Stage 2 (German Copy) →
                        </button>
                      </div>
                    )}
                  </StageCard>

                  <StageCard
                    number={3}
                    title="Stage 3 — Image Generation"
                    description="7 Higgsfield prompts (3 infographic + 4 contextual), generated sequentially"
                    state={imageStageCardState(pipeline, errorStage, 3)}
                  >
                    {pipelineIsStage3PromptsRunning && (
                      <p className="text-xs text-[#404040] font-mono">Generating image prompts...</p>
                    )}

                    {errorStage === 13 && (
                      <div className="space-y-2">
                        <p className="text-xs text-[#dc2626] font-mono">Error: {errorMessage}</p>
                        <button
                          onClick={runStage3}
                          className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] rounded text-xs font-mono text-[#737373] hover:text-[#e5e5e5] transition-colors"
                        >
                          Retry Stage 3
                        </button>
                      </div>
                    )}

                    {imageSlots.length > 0 && (
                      <ImageGrid
                        slots={imageSlots}
                        currentIndex={currentImageIndex}
                        onRetry={retryImage}
                      />
                    )}

                    {isDone && (
                      <div>
                        <p className="text-xs font-mono text-[#16a34a] mt-3">
                          Image generation complete —{" "}
                          {imageSlots.filter((s) => s.status === "done").length} of{" "}
                          {imageSlots.length} images generated.
                          {runId && (
                            <a
                              href={`/history/${runId}`}
                              className="ml-3 text-[#2563eb] hover:underline"
                            >
                              View run →
                            </a>
                          )}
                        </p>
                        <FeedbackBar runId={runId} stage={3} />
                      </div>
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
