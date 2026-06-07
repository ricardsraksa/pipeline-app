"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { version as APP_VERSION } from "../package.json";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

function NavIcon({ kind, className }: { kind: "new" | "runs" | "settings"; className?: string }) {
  const base = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "new") return <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
  if (kind === "runs") return <svg {...base}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
  return (
    <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  );
}

export default function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    const initial = saved || "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const item = (href: string, label: string, kind: "new" | "runs" | "settings") => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={cx(
          "relative flex items-center rounded-[var(--radius-sm)] text-[13.5px] tr",
          collapsed ? "justify-center px-0 py-[10px]" : "gap-[11px] px-[11px] py-[9px]",
          active
            ? "bg-[var(--color-accent-weak)] text-[var(--color-accent-text)] font-[650]"
            : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] font-[550]"
        )}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-full bg-[var(--color-accent)]" />}
        <span className="opacity-90 shrink-0"><NavIcon kind={kind} className="w-[17px] h-[17px]" /></span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  return (
    <aside className="relative sticky top-0 h-screen border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col px-3 py-4 gap-1 shrink-0">
      {/* collapse toggle on the right edge */}
      <button
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{ position: "absolute", right: 0, top: "50%", transform: "translate(50%, -50%)", zIndex: 50 }}
        className="w-[22px] h-[22px] grid place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] shadow-[var(--shadow-card)] tr cursor-pointer"
      >
        <svg className={cx("w-3.5 h-3.5 tr", !collapsed && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </button>

      {/* Brand */}
      <div className={cx("flex items-center pb-[14px] pt-[6px]", collapsed ? "justify-center px-0" : "gap-[10px] px-2")}>
        <span className="w-[30px] h-[30px] rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-on-primary)] grid place-items-center shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none"><path d="M4 18V6l7 5-7 5z" fill="currentColor" /><path d="M12 18V6l8 6-8 6z" fill="currentColor" opacity="0.45" /></svg>
        </span>
        {!collapsed && <span className="font-bold tracking-tight text-[15.5px] ff-display text-[var(--color-text)]">Pipeline</span>}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {item("/", "New Run", "new")}
        {item("/history", "Runs", "runs")}
        {item("/settings", "Settings", "settings")}
      </nav>

      <div className="flex-1" />

      {/* Footer */}
      <div className="border-t border-[var(--color-border)] pt-3 flex flex-col gap-2.5">
        {!collapsed && (
          <p className="ff-mono text-[10px] text-[var(--color-text-2)] select-text" title={`Pipeline app v${APP_VERSION}`}>
            v{APP_VERSION}
          </p>
        )}
        <div className={cx("flex items-center", collapsed ? "justify-center" : "justify-between gap-2")}>
          <div className={cx("flex items-center gap-2 text-xs text-[var(--color-text-2)] min-w-0", collapsed && "hidden")}>
            <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-green)] shrink-0 pulse-dot" />
            <span className="truncate">Higgsfield connected</span>
          </div>
          {collapsed && <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-green)] shrink-0 pulse-dot" title="Higgsfield connected" />}
          {!collapsed && (
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] grid place-items-center text-sm tr hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] shrink-0 cursor-pointer"
              title="Toggle theme"
            >
              {theme === "light" ? "☾" : "☀"}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
