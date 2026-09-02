"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.success) { setErr(data.error ?? `Login failed (${res.status})`); return; }
      // Open-redirect guard: resolve against our origin with the REAL URL
      // parser and require the result to stay on it. String-prefix checks
      // miss backslash forms ("/\\evil.com") that browsers normalise to "//".
      let dest = "/";
      try {
        const u = new URL(params.get("next") ?? "/", window.location.origin);
        if (u.origin === window.location.origin) dest = u.pathname + u.search + u.hash;
      } catch { /* keep "/" */ }
      window.location.href = dest;
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center" style={{ background: "var(--color-bg)" }}>
      <div className="w-[320px] flex flex-col gap-[18px]">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[22px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Pipeline</h1>
          <span className="ff-mono text-[11px] text-[var(--color-text-3)]">v{process.env.NEXT_PUBLIC_APP_VERSION ?? ""}</span>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="h-[38px] px-[11px] rounded-[6px] bg-[var(--color-surface)] border border-[var(--color-border-strong)] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-3)] tr"
          />
          <button
            type="submit"
            disabled={busy || !password}
            className="cursor-pointer h-[38px] rounded-[6px] bg-[var(--color-primary)] text-[var(--color-on-primary)] font-[500] hover:opacity-90 disabled:opacity-50 tr"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
