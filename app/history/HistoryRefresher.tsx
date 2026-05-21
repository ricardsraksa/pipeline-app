"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Invisible client component that refreshes the history server component.
 * - Every 5 s when there are active runs (polling-friendly).
 * - Every 30 s when everything is settled (heartbeat so new runs still appear).
 */
export function HistoryRefresher({ hasActiveRuns }: { hasActiveRuns: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const interval = hasActiveRuns ? 5_000 : 30_000;
    const id = setInterval(() => router.refresh(), interval);
    return () => clearInterval(id);
  }, [hasActiveRuns, router]);

  return null;
}
