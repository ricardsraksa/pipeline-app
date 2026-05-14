"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Pipeline" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="max-w-2xl mx-auto px-4 flex items-center gap-6 h-12">
        <span className="font-mono text-xs text-[#2563eb] tracking-[0.15em] uppercase mr-4">
          DTC Pipeline
        </span>
        {links.map(({ href, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={[
                "text-xs font-mono uppercase tracking-wider transition-colors",
                active ? "text-[#e5e5e5]" : "text-[#404040] hover:text-[#737373]",
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
