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
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] p-6">
        <div>
          <h1 className="text-[16px] font-[640] text-[var(--color-text)]">Pipeline</h1>
          <p className="text-[12px] text-[var(--color-text-3)] mt-0.5">Enter the password to continue.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
        />
        {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="cursor-pointer w-full rounded-md px-3 py-2 text-[13px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
