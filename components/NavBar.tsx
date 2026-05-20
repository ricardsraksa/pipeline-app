"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

const APP_VERSION = "v2.9";

const links = [
  { href: "/", label: "Pipeline", icon: Icon.Pipeline },
  { href: "/history", label: "History", icon: Icon.History },
  { href: "/settings", label: "Settings", icon: Icon.Settings },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-5 h-12 flex items-center gap-1">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 mr-3 group"
          aria-label="Home"
        >
          <span
            className="grid place-items-center w-5 h-5 rounded-md text-white"
            style={{
              background: "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dim) 100%)",
            }}
          >
            <Icon.Pipeline className="w-3 h-3" strokeWidth={2.4} />
          </span>
          <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-[var(--color-text)] font-medium">
            Pipeline
          </span>
        </Link>

        <span className="h-3.5 w-px bg-[var(--color-border)] mx-1" aria-hidden />

        {/* Nav items */}
        {links.map(({ href, label, icon: ItemIcon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={[
                "cursor-pointer inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors duration-150",
                active
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <ItemIcon className="w-3.5 h-3.5" />
              <span className="font-sans">{label}</span>
            </Link>
          );
        })}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://cloud.higgsfield.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
          >
            Higgsfield
            <Icon.ExternalLink className="w-3 h-3" />
          </a>
          <span className="font-mono text-[10px] text-[var(--color-text-4)] select-none" aria-label="App version">
            {APP_VERSION}
          </span>
        </div>
      </div>
    </nav>
  );
}
