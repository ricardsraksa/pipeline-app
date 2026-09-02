"use client";

// Sticky 50px header: wordmark and version, the three destinations with an
// underline on the current one, a count of runs that need the operator, the
// theme toggle and sign out.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

function Tab({ href, label, active, badge }: { href: string; label: string; active: boolean; badge?: number }) {
  return (
    <Link href={href}
      className={cx("relative cursor-pointer flex items-center gap-[7px] px-[10px] py-[7px] rounded-[6px] text-[13px] tr",
        active ? "text-[var(--color-text)]" : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]")}>
      <span>{label}</span>
      {badge ? (
        <span className="ff-mono text-[10px] px-[5px] py-px rounded-full bg-[var(--color-red-bg)] text-[var(--color-red)]">{badge}</span>
      ) : null}
      {active && <span className="absolute left-[10px] right-[10px] -bottom-px h-[2px] rounded-[2px] bg-[var(--color-accent)]" />}
    </Link>
  );
}

export default function TopBar() {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [needs, setNeeds] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = (localStorage.getItem("pipeline-theme") as "dark" | "light" | null) ?? "dark";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  useEffect(() => {
    if (path === "/login") return;
    let live = true;
    const load = () => fetch("/api/runs/counts").then((r) => r.json()).then((d) => { if (live) setNeeds(Number(d?.needs ?? 0)); }).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [path]);

  if (path === "/login") return null;

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("pipeline-theme", next); } catch { /* private mode */ }
  };

  async function signOut() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    router.push("/login");
  }

  const isRun = path.startsWith("/runs") || path === "/";
  return (
    <header className="sticky top-0 z-30 h-[50px] flex items-center gap-6 px-[22px] border-b border-[var(--color-border)]"
      style={{ background: "color-mix(in srgb, var(--color-bg) 78%, transparent)", backdropFilter: "blur(14px) saturate(160%)" }}>
      <Link href="/" className="cursor-pointer flex items-baseline gap-[7px]">
        <span className="text-[15px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Pipeline</span>
        <span className="ff-mono text-[10px] text-[var(--color-text-3)]">v{process.env.NEXT_PUBLIC_APP_VERSION ?? ""}</span>
      </Link>
      <nav className="flex items-center gap-[2px]">
        <Tab href="/" label="Home" active={isRun} badge={needs} />
        <Tab href="/new" label="New run" active={path === "/new"} />
        <Tab href="/settings" label="Settings" active={path === "/settings"} />
      </nav>
      <div className="flex-1" />
      <button onClick={toggle} title="Light / dark" aria-label="Toggle theme"
        className="cursor-pointer h-7 px-[9px] rounded-[6px] grid place-items-center text-[12px] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] tr">
        {theme === "dark" ? "☾" : "☀"}
      </button>
      <button onClick={signOut} className="cursor-pointer text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text)] tr">Sign out</button>
    </header>
  );
}
