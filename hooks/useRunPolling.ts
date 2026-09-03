"use client";

import type { PricingRules, ProductPricing } from "@/lib/pricing";
import { useEffect, useState, useRef } from "react";

export interface RunStatus {
  runId: number;
  status: string;
  currentStep: string | null;
  error: string | null;
  /** JSON string of the prompts this run executed with (null on older runs). */
  promptsUsed: string | null;
  outputs: {
    research: string | null;
    chiefMid: string | null;
    researchRevised: string | null;
    avatar: string | null;
    offerBrief: string | null;
    necessaryBeliefs: string | null;
    chiefFinal: string | null;
    avatarRevised: string | null;
    offerBriefRevised: string | null;
    necessaryBeliefsRevised: string | null;
    onePager: string | null;
    onePagerEdited: string | null;
    onePagerEditedAt: string | null;
    stage2Output: string | null;
    stage2OutputEdited: string | null;
    stage2EditedAt: string | null;
    stage2Json: string | null;
    gdocAppendedAt: string | null;
  };
  images: {
    scrapedUrls: string[];
    approvedUrls: string[];
  };
  stage4: { hero: string | null; done: number; total: number };
  /** Stage 1 · Product — scrape JSON (see lib/product.ts), analyst text, gate state. */
  product: {
    scrape: string | null;
    descriptionAi: string | null;
    descriptionEdited: string | null;
    selectedImages: string[];
    approvedAt: string | null;
    workerLastSeen: string | null;
  };
  /** Angles gate — JSON strings (Angle[] / Angle), see lib/angles.ts. */
  angles: {
    proposed: string | null;
    selected: string | null;
  };
  meta: {
    productUrl: string;
    productName: string | null;
    productCode: string | null;
    shopifyProductUrl: string | null;
    brandName: string | null;
    productDescription: string | null;
    uploadedSourceImages: string[];
    competitorUrls: string[];
    pricing: ProductPricing | null;
    pricingRules: PricingRules;
    variantsRequestedAt: string | null;
  };
  timestamps: {
    startedAt: string | null;
    lastUpdatedAt: string | null;
    completedAt: string | null;
  };
  feedback: {
    stage1: string | null;
    stage2: string | null;
    stage3: string | null;
    stage1Note: string | null;
    stage2Note: string | null;
    stage3Note: string | null;
  };
  scrapeErrors: { url: string; error: string }[];
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "awaiting_user", "awaiting_qc"]);

export function useRunPolling(runId: number | null, intervalMs = 3000): RunStatus | null {
  const [data, setData] = useState<RunStatus | null>(null);
  // Never stop polling: Stage 4 generates images from the browser with
  // per-image saves, so the run keeps changing while its status word sits at
  // a gate. Fast while the server is working, slow (but alive) otherwise, plus
  // an immediate refetch on tab focus and on the "run:changed" event that
  // components fire after their own writes.
  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastStatus = "";

    const schedule = () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      const delay = TERMINAL_STATUSES.has(lastStatus) ? Math.max(intervalMs, 8000) : intervalMs;
      timer = setTimeout(poll, delay);
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/status`);
        if (res.ok) {
          const json: RunStatus = await res.json();
          if (active) { setData(json); lastStatus = json.status; }
        }
      } catch {
        // Network hiccup — keep polling
      }
      schedule();
    };
    const refetchNow = () => { if (timer) clearTimeout(timer); void poll(); };
    const onVisible = () => { if (document.visibilityState === "visible") refetchNow(); };

    void poll();
    window.addEventListener("focus", refetchNow);
    window.addEventListener("run:changed", refetchNow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refetchNow);
      window.removeEventListener("run:changed", refetchNow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runId, intervalMs]);

  return data;
}
