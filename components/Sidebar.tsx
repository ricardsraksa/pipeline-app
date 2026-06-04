"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { version as APP_VERSION } from "../package.json";

export default function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    const initial = saved || "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const navLinkClass = (href: string) =>
    [
      "relative flex items-center gap-[11px] px-[11px] py-[9px] rounded-lg text-[13.5px] font-[550] transition-colors duration-150",
      isActive(href)
        ? "bg-[var(--color-accent-weak)] text-[var(--color-accent-text)] font-[650]"
        : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
    ].join(" ");

  return (
    <aside
      style={{ width: 236 }}
      className="sticky top-0 h-screen border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col px-3 py-4 gap-1 shrink-0"
    >
      {/* Brand */}
      <div className="flex items-center gap-[10px] px-2 pb-[14px] pt-[6px]">
        <span
          className="w-[30px] h-[30px] rounded-lg bg-[var(--color-primary)] text-white grid place-items-center font-extrabold text-[15px] shrink-0"
        >
          P
        </span>
        <span className="font-bold tracking-tight text-[15.5px] text-[var(--color-text)]">
          Pipeline
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        <Link href="/" className={navLinkClass("/")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-85 shrink-0">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Run
        </Link>
        <Link href="/history" className={navLinkClass("/history")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-85 shrink-0">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Runs
        </Link>
        <Link href="/settings" className={navLinkClass("/settings")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-85 shrink-0">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2A1.7 1.7 0 0 0 6.2 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 5 6.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V2a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H22a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z" />
          </svg>
          Settings
        </Link>
      </nav>

      <div className="flex-1" />

      {/* Footer */}
      <div className="border-t border-[var(--color-border)] pt-3">
        <p
          className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-2)] mb-1.5 select-text"
          title={`Pipeline app v${APP_VERSION}`}
        >
          v{APP_VERSION}
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-2)] min-w-0">
            <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-green)] shrink-0" />
            <span className="truncate">Higgsfield connected</span>
          </div>
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] grid place-items-center text-sm transition-colors hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] shrink-0 cursor-pointer"
            title="Toggle theme"
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </div>
    </aside>
  );
}
