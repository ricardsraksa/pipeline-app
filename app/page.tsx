"use client";

import { useState } from "react";
import StageCard from "@/components/StageCard";
import OutputBlock from "@/components/OutputBlock";
import ImageUploader from "@/components/ImageUploader";
import ImageGrid from "@/components/ImageGrid";
import FeedbackBar from "@/components/FeedbackBar";
import type { ImagePrompt } from "@/app/api/stage3-prompts/route";

type PipelineState =
  | "idle"
  | "scraping"
  | "stage1_running"
  | "stage1_done"
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

function stageCardState(
  pipeline: PipelineState,
  errorStage: number | null,
  stageNum: number
): "locked" | "running" | "complete" | "error" {
  if (errorStage === stageNum) return "error";
  if (stageNum === 1) {
    if (pipeline === "stage1_running" || pipeline === "scraping") return "running";
    if (
      ["stage1_done", "stage2_running", "stage2_done",
       "stage3_prompts_running", "stage3_prompts_done",
       "stage3_images_running", "stage3_images_done"].includes(pipeline)
    ) return "complete";
    return "locked";
  }
  if (stageNum === 2) {
    if (pipeline === "stage2_running") return "running";
    if (
      ["stage2_done", "stage3_prompts_running", "stage3_prompts_done",
       "stage3_images_running", "stage3_images_done"].includes(pipeline)
    ) return "complete";
    return "locked";
  }
  if (stageNum === 3) {
    if (
      pipeline === "stage3_prompts_running" ||
      pipeline === "stage3_images_running"
    ) return "running";
    if (pipeline === "stage3_images_done") return "complete";
    return "locked";
  }
  return "locked";
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>("idle");
  const [errorStage, setErrorStage] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [userImages, setUserImages] = useState<string[]>([]);
  const [showImageUploader, setShowImageUploader] = useState(false);

  const [stage1Output, setStage1Output] = useState("");
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

  async function runScrapeAndStage1() {
    if (!url.trim()) return;

    setErrorStage(null);
    setErrorMessage("");
    setStage1Output("");
    setStage2Output("");
    setImageSlots([]);
    setScrapedImages([]);
    setShowImageUploader(false);
    setRunId(null);

    setPipeline("scraping");

    let scraped = "";
    let imgs: string[] = [];
    let competitorScraped: { url: string; text: string }[] = [];

    const competitorList = competitorUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

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

      // First result is the main product URL
      const mainResult = scrapeResults[0];
      if (mainResult.status === "fulfilled" && mainResult.value.success) {
        scraped = mainResult.value.scraped_text ?? "";
        imgs = mainResult.value.images ?? [];
      }

      // Remaining results are competitors — collect their images and text
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

    setPipeline("stage1_running");

    try {

      const res = await fetch("/api/stage1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          scraped_text: scraped,
          competitor_urls: competitorList,
          competitor_scraped: competitorScraped,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Stage 1 failed");
      setStage1Output(data.output);
      // Auto-extract suggested product name from stage1 output
      const nameMatch = (data.output as string).match(/^PRODUCT_NAME:\s*(.+)$/m);
      if (nameMatch?.[1]) setProductName(nameMatch[1].trim());
      setPipeline("stage1_done");
    } catch (err) {
      setError(1, err instanceof Error ? err.message : String(err));
    }
  }

  async function runStage2() {
    if (!stage1Output) return;
    setErrorStage(null);
    setErrorMessage("");
    setPipeline("stage2_running");

    try {
      const res = await fetch("/api/stage2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage1_output: stage1Output, product_name: productName }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Stage 2 failed");
      setStage2Output(data.output);
      setPipeline("stage2_done");
    } catch (err) {
      setError(2, err instanceof Error ? err.message : String(err));
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
      const slots: ImageSlot[] = prompts.map((p) => ({
        prompt: p,
        status: "pending",
      }));
      setImageSlots(slots);
      setPipeline("stage3_prompts_done");

      await generateImagesSequentially(prompts, slots);
    } catch (err) {
      setError(3, err instanceof Error ? err.message : String(err));
    }
  }

  async function generateImagesSequentially(
    prompts: ImagePrompt[],
    initialSlots: ImageSlot[]
  ) {
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
            slots[i] = {
              ...slots[i],
              status: "error",
              error: data.error ?? "Generation failed",
            };
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

    // Auto-save run to DB
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
          stage1_output: stage1Output,
          stage2_output: stage2Output,
          stage3_prompts: prompts,
          image_urls: imageUrls,
        }),
      });
      const saveData = await saveRes.json();
      if (saveData.id) setRunId(Number(saveData.id));
    } catch {
      // Non-critical — pipeline still completed
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
        body: JSON.stringify({
          prompt_obj: imageSlots[slotIndex].prompt,
          images: allImages,
        }),
      });
      const data = await res.json();
      if (data.success && data.image_url) {
        updated[slotIndex] = {
          ...updated[slotIndex],
          status: "done",
          imageUrl: data.image_url,
        };
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

  const isScraping = pipeline === "scraping";
  const isStage1Running = pipeline === "stage1_running";
  const isStage2Running = pipeline === "stage2_running";
  const isStage3PromptsRunning = pipeline === "stage3_prompts_running";
  const isDone = pipeline === "stage3_images_done";

  const pipelineActive =
    pipeline !== "idle" && pipeline !== "error" && errorStage !== 1;
  const canStartPipeline =
    url.trim().length > 0 && (!pipelineActive || errorStage === 1);
  const canRunStage2 =
    pipeline === "stage1_done" && productName.trim().length > 0;
  const hasEnoughImages = allImages.length >= 2;
  const canRunStage3 = pipeline === "stage2_done" && (!showImageUploader || hasEnoughImages);

  return (
    <main className="min-h-screen bg-[#0a0a0a] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-7">
          <p className="text-[#404040] text-sm">
            Enter an Alibaba or AliExpress product URL to run the 3-stage research, copy,
            and image pipeline.
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
              onKeyDown={(e) => e.key === "Enter" && canStartPipeline && runScrapeAndStage1()}
              placeholder="https://www.aliexpress.com/item/..."
              disabled={pipelineActive && errorStage !== 1}
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2.5 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb] disabled:opacity-40 transition-colors"
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
                disabled={pipelineActive && errorStage !== 1}
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb] disabled:opacity-40 resize-none transition-colors"
              />
            </div>
          </details>
        </div>

        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={runScrapeAndStage1}
            disabled={!canStartPipeline || isStage1Running || isScraping}
            className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
          >
            {isScraping
              ? "Scraping..."
              : isStage1Running
              ? "Running..."
              : errorStage === 1
              ? "Retry Stage 1"
              : "Start Pipeline"}
          </button>

          {(isScraping || isStage1Running) && (
            <span className="text-xs font-mono text-[#737373] flex items-center gap-1.5">
              <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-[#737373] inline-block" />
              {isScraping ? "Fetching product page..." : "Generating research brief..."}
            </span>
          )}
        </div>

        {pipeline !== "idle" && (
          <div className="space-y-4">
            {/* Stage 1 */}
            <StageCard
              number={1}
              title="Stage 1 — Research Brief"
              description="Market analysis, pain points, competitive landscape, image strategy"
              state={stageCardState(pipeline, errorStage, 1)}
            >
              {(isScraping || isStage1Running) && (
                <p className="text-xs text-[#404040] font-mono">
                  {isScraping ? "Scraping product page..." : "Generating research brief..."}
                </p>
              )}

              {errorStage === 1 && (
                <p className="text-xs text-[#dc2626] font-mono">Error: {errorMessage}</p>
              )}

              {stage1Output && !isStage1Running && !isScraping && (
                <div className="space-y-3">
                  <OutputBlock text={stage1Output} monospace />

                  <FeedbackBar runId={runId} stage={1} />

                  {(pipeline === "stage1_done" || errorStage === 2) && (
                    <div className="space-y-3 pt-1 border-t border-[#1a1a1a] mt-3">
                      {showImageUploader && (
                        <div>
                          <p className="text-xs font-mono text-[#b45309] mb-2">
                            Scrape returned fewer than 2 images — add reference images for Stage 3:
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
                          onKeyDown={(e) =>
                            e.key === "Enter" && canRunStage2 && runStage2()
                          }
                          placeholder="e.g. WELLENFROH"
                          className="w-full bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#333] focus:outline-none focus:border-[#2563eb]"
                        />
                      </div>
                      <button
                        onClick={runStage2}
                        disabled={!canRunStage2}
                        className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
                      >
                        {errorStage === 2 ? "Retry Stage 2" : "Run Stage 2 →"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </StageCard>

            {/* Stage 2 */}
            <StageCard
              number={2}
              title="Stage 2 — German Copy"
              description="Product names, headlines, benefits, FAQs, Facebook copy, one-liners"
              state={stageCardState(pipeline, errorStage, 2)}
            >
              {isStage2Running && (
                <p className="text-xs text-[#404040] font-mono">Generating German copy kit...</p>
              )}

              {errorStage === 2 && (
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

              {stage2Output && !isStage2Running && (
                <div className="space-y-3">
                  <OutputBlock text={stage2Output} />

                  <FeedbackBar runId={runId} stage={2} />

                  {pipeline === "stage2_done" && (
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
                        title={!canRunStage3 && showImageUploader ? "Add at least 2 reference images first" : undefined}
                        className="px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1a1a1a] disabled:text-[#3a3a3a] text-white rounded font-mono text-sm transition-colors"
                      >
                        Continue to Stage 3 →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </StageCard>

            {/* Stage 3 */}
            <StageCard
              number={3}
              title="Stage 3 — Image Generation"
              description="7 Higgsfield prompts (3 infographic + 4 contextual), generated sequentially"
              state={stageCardState(pipeline, errorStage, 3)}
            >
              {isStage3PromptsRunning && (
                <p className="text-xs text-[#404040] font-mono">Generating image prompts...</p>
              )}

              {errorStage === 3 && (
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
                    Pipeline complete —{" "}
                    {imageSlots.filter((s) => s.status === "done").length} of{" "}
                    {imageSlots.length} images generated.
                    {runId && (
                      <a href={`/history/${runId}`} className="ml-3 text-[#2563eb] hover:underline">
                        View run →
                      </a>
                    )}
                  </p>
                  <FeedbackBar runId={runId} stage={3} />
                </div>
              )}
            </StageCard>
          </div>
        )}
      </div>
    </main>
  );
}
