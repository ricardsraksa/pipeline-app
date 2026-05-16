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
    <nav className="border-b border-[#111] bg-black sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-5 flex items-center gap-6 h-12">
        <span className="font-mono text-[10px] text-white tracking-[0.25em] uppercase mr-2">
          Pipeline
        </span>
        <div className="w-px h-3 bg-[#222]" />
        {links.map(({ href, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={[
                "font-mono text-[11px] transition-colors duration-150",
                active ? "text-white" : "text-[#333] hover:text-[#666]",
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
