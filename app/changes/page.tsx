// Every release, newest first, from lib/changelog.json (written by
// scripts/changelog.mjs from the git history).

import changelog from "@/lib/changelog.json";

type Entry = { version: string; date: string; title: string; items: string[] };

const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ChangesPage() {
  const entries = changelog as Entry[];
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "44px 22px 80px" }} data-screen-label="Changes">
      <h1 className="text-[19px] font-[600] tracking-[-0.02em] mb-[26px] text-[var(--color-text)]">Changes</h1>
      <ol className="flex flex-col">
        {entries.map((e) => (
          <li key={e.version} className="grid grid-cols-[92px_1fr] gap-4 py-[14px] border-t border-[var(--color-border)]">
            <div className="flex flex-col gap-0.5 pt-px">
              <span className="ff-mono text-[11.5px] text-[var(--color-text)]">v{e.version}</span>
              <span className="text-[11.5px] text-[var(--color-text-3)]">{fmt(e.date)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] text-[var(--color-text)] leading-[1.45]">{cap(e.title)}</p>
              {e.items.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1 list-disc pl-4 marker:text-[var(--color-text-4)]">
                  {e.items.map((it, i) => <li key={i} className="text-[12.5px] text-[var(--color-text-2)] leading-[1.45]">{it}</li>)}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
