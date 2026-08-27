"use client";

// Global 401 handler: patches window.fetch so any authenticated API call that
// comes back 401 (expired/rotated session) sends the operator to /login with a
// return path — instead of ~60 call sites individually choking on JSON 401s.

import { useEffect } from "react";

export default function AuthWatch() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].pathname : (args[0] as Request).url;
        if (res.status === 401 && typeof url === "string" && url.includes("/api/") && !url.includes("/api/auth/") && !redirecting) {
          redirecting = true;
          window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
        }
      } catch { /* never break the caller */ }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  return null;
}
