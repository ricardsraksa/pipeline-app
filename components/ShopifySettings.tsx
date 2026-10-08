"use client";
// Settings → Shopify: the template product every new run's product is copied
// from. One field, checked against the store on save.
import { useEffect, useState } from "react";

interface Info { title: string; handle: string; adminUrl: string; mediaCount: number; variantCount: number; options: string[]; warnings: string[] }

export default function ShopifySettings() {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/shopify").then((r) => r.json()).then((d) => {
      setUrl(d.url ?? ""); setSaved(d.url ?? null); setInfo(d.info ?? null); setErr(d.error ?? null);
    }).catch(() => setErr("Couldn't load")).finally(() => setLoaded(true));
  }, []);

  async function save(next: string | null) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/settings/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: next }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? `Failed (${r.status})`); return; }
      setSaved(d.url ?? null); setUrl(d.url ?? ""); setInfo(d.info ?? null);
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  const dirty = url.trim() !== (saved ?? "");
  return (
    <section className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] px-5 py-4 space-y-3">
      <div>
        <p className="text-[13px] font-[600] text-[var(--color-text)]">Template product</p>
      </div>
      {!loaded ? (
        <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading…</p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dirty) void save(url.trim() || null); }}
              placeholder="Shopify product link" spellCheck={false} disabled={busy}
              className="flex-1 min-w-[260px] h-[38px] px-3 rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12.5px] ff-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]" />
            <button onClick={() => void save(url.trim() || null)} disabled={busy || !dirty} className="btn btn-sm cursor-pointer">{busy ? "Checking…" : "Save"}</button>
            {saved && !dirty && <button onClick={() => void save(null)} disabled={busy} className="btn btn-sm cursor-pointer">Remove</button>}
          </div>
          {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
          {info && !dirty && (
            <div className="text-[12px] text-[var(--color-text-2)] space-y-1">
              <p>Using <a href={info.adminUrl} target="_blank" rel="noreferrer" className="underline">{info.title}</a> · {info.variantCount <= 1 && !info.options.length ? "single variant" : `${info.variantCount} variants`} · {info.mediaCount} image{info.mediaCount === 1 ? "" : "s"}</p>
              {info.warnings.map((w) => <p key={w} className="text-[var(--color-amber)]">{w}</p>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
