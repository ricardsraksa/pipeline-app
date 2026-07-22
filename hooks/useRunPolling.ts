"use client";

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
  };
  images: {
    scrapedUrls: string[];
    approvedUrls: string[];
  };
  meta: {
    productUrl: string;
    productName: string | null;
    brandName: string | null;
    productDescription: string | null;
    uploadedSourceImages: string[];
    competitorUrls: string[];
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!runId) return;

    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/status`);
        if (!res.ok) return;
        const json: RunStatus = await res.json();
        if (active) {
          setData(json);
          // Stop polling once in a terminal state
          if (TERMINAL_STATUSES.has(json.status)) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }
      } catch {
        // Network hiccup — keep polling
      }
    };

    poll(); // immediate first fetch
    intervalRef.current = setInterval(poll, intervalMs);

    return () => {
      active = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runId, intervalMs]);

  // Resume polling when status becomes active again (e.g. after resume)
  useEffect(() => {
    if (!data || !runId) return;
    if (!TERMINAL_STATUSES.has(data.status) && !intervalRef.current) {
      const poll = async () => {
        try {
          const res = await fetch(`/api/runs/${runId}/status`);
          if (!res.ok) return;
          const json: RunStatus = await res.json();
          setData(json);
          if (TERMINAL_STATUSES.has(json.status)) {
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
          }
        } catch {}
      };
      intervalRef.current = setInterval(poll, intervalMs);
    }
  }, [data?.status, runId, intervalMs]);

  return data;
}
