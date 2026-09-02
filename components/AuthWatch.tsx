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
        const raw = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
        // Resolve properly: only OUR /api/* endpoints count, never a
        // third-party URL that happens to contain "/api/".
        const u = new URL(raw, window.location.origin);
        const ours = u.origin === window.location.origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/");
        // NEVER redirect from the login page itself — layout components (TopBar)
        // fetch APIs that legitimately 401 there, and redirecting /login to
        // /login is an infinite reload loop.
        const onLogin = window.location.pathname === "/login";
        if (res.status === 401 && ours && !onLogin && !redirecting) {
          redirecting = true;
          window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname + window.location.search);
        }
      } catch { /* never break the caller */ }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  return null;
}
