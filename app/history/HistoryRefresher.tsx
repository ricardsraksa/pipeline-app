"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Invisible client component that refreshes the history server component.
 *
 * Triggers:
 *  - On mount (so navigating in from a fresh "Start" picks up the new row immediately).
 *  - On window focus / tab-visible (so coming back from another tab is instant).
 *  - Every 5 s when active runs exist (live progress).
 *  - Every 15 s when idle (heartbeat to surface newly started runs).
 */
export function HistoryRefresher({ hasActiveRuns }: { hasActiveRuns: boolean }) {
  const router = useRouter();

  useEffect(() => {
    // Initial refresh on mount — covers "start run → navigate to /history" where the
    // RSC payload was rendered before the new row existed.
    router.refresh();

    const interval = hasActiveRuns ? 5_000 : 15_000;
    const id = setInterval(() => router.refresh(), interval);

    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const onFocus = () => router.refresh();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [hasActiveRuns, router]);

  return null;
}
