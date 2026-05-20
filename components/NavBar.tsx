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
    <nav className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 flex items-center gap-1 h-11">
        <div className="flex items-center gap-3 mr-4">
          <span className="font-mono text-[11px] text-zinc-100 tracking-[0.2em] uppercase font-medium">
            Pipeline
          </span>
          <div className="w-px h-3.5 bg-zinc-800" />
        </div>
        {links.map(({ href, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={[
                "font-mono text-[11px] px-3 py-1.5 rounded-md transition-colors duration-150",
                active
                  ? "text-zinc-100 bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50",
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
        <span className="ml-auto font-mono text-[10px] text-zinc-700 select-none">v2.1</span>
      </div>
    </nav>
  );
}
