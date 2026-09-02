"use client";

// v2 TopBar — sticky 54px header: logo, Home / New run / Settings tabs,
// theme toggle. Home tab shows a needs-you count badge when away from home.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function TopBar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [needsCount, setNeedsCount] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("pl2_theme") as "light" | "dark" | null;
    const initial = saved || "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pl2_theme", next);
  };

  // Needs-you badge: refresh on navigation and every 30s.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/runs/counts")
        .then((r) => r.json())
        .then((d) => { if (alive && typeof d.needs === "number") setNeedsCount(d.needs); })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [pathname]);

  const route = pathname === "/" || pathname.startsWith("/runs") || pathname.startsWith("/history") ? "home"
    : pathname.startsWith("/new") ? "new"
    : pathname.startsWith("/settings") ? "settings" : "";

  const tab = (id: string, href: string, label: string) => (
    <Link href={href} className={cx(
      "relative px-3 py-1.5 rounded-[var(--radius-sm)] text-[13px] font-[600] tr cursor-pointer whitespace-nowrap",
      route === id ? "bg-[var(--color-accent-weak)] text-[var(--color-accent-text)]" : "text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]")}>
      {label}
      {id === "home" && needsCount > 0 && route !== "home" && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-amber)] text-white text-[9.5px] font-bold grid place-items-center">{needsCount}</span>
      )}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 h-[54px] border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_90%,transparent)] backdrop-blur-md">
      <div className="h-full px-5 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
          <span className="w-[28px] h-[28px] rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-on-primary)] grid place-items-center shrink-0"><Icon.Logo className="w-4 h-4" /></span>
          <span className="font-bold tracking-tight text-[15px] ff-display text-[var(--color-text)]">Pipeline <span title="App version (of this deployed build)" className="ff-mono text-[10px] text-[var(--color-text-4)] font-medium align-top">v{process.env.NEXT_PUBLIC_APP_VERSION ?? "2"}</span></span>
        </Link>
        <nav className="flex items-center gap-1">
          {tab("home", "/", "Home")}
          {tab("new", "/new", "New run")}
          {tab("settings", "/settings", "Settings")}
          <div className="w-px h-5 bg-[var(--color-border)] mx-2" />
          <button onClick={toggleTheme} title="Toggle theme"
            className="w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] grid place-items-center tr hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] cursor-pointer">
            {theme === "light" ? <Icon.Moon className="w-4 h-4" /> : <Icon.Sun className="w-4 h-4" />}
          </button>
        </nav>
      </div>
    </header>
  );
}
