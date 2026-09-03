"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseProductScrape } from "@/lib/product";
import {
  buildPricing, compareAtFor, fitFor, fmtMoney, pricingWarnings, round2,
  type PricingRules, type ProductPricing,
} from "@/lib/pricing";

// Suggested retail price for the run: rules (× COGS, .95 ending, compare-at
// bump) against the competitor prices the scrape read. Lives on Stage 3 above
// the copy kit; edits persist on the run. Nothing downstream reads it.
export default function PricingCard({ runId, scrape, pricing, rules }: {
  runId: number;
  scrape: string | null;
  pricing: ProductPricing | null;
  rules: PricingRules;
}) {
  const parsed = useMemo(() => parseProductScrape(scrape), [scrape]);
  const [p, setP] = useState<ProductPricing | null>(() => pricing ?? (parsed ? buildPricing(parsed, rules) : null));
  const [err, setErr] = useState<string | null>(null);

  // Server value wins only when it is newer than what we hold (polling
  // delivers our own saves back; an older row must not undo a fresh edit).
  useEffect(() => {
    if (pricing && (!p || pricing.at > p.at)) setP(pricing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing]);

  const save = (next: ProductPricing) => {
    setP(next);
    setErr(null);
    fetch(`/api/runs/${runId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_pricing: JSON.stringify(next) }),
    })
      .then(async (r) => { if (!r.ok) { const d = await r.json().catch(() => ({})); setErr((d as { error?: string }).error || `Could not save (${r.status})`); } })
      .catch(() => setErr("Network error saving pricing"));
  };

  // First visit with no stored pricing: persist the auto suggestion once so the
  // rail row appears without a click.
  const autoSaved = useRef(false);
  useEffect(() => {
    if (!pricing && p && p.source === "auto" && !autoSaved.current) { autoSaved.current = true; save(p); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text drafts for the three inputs; re-seeded whenever the pricing changes.
  const [draft, setDraft] = useState({ cogs: "", price: "", compare_at: "" });
  useEffect(() => {
    setDraft({ cogs: p ? p.cogs.toFixed(2) : "", price: p ? p.price.toFixed(2) : "", compare_at: p ? p.compare_at.toFixed(2) : "" });
  }, [p]);

  const commit = (field: "cogs" | "price" | "compare_at") => {
    const v = round2(Number(draft[field].replace(",", ".")));
    if (!Number.isFinite(v) || v <= 0) { setDraft((d) => ({ ...d, [field]: p ? p[field].toFixed(2) : "" })); return; }
    if (field === "cogs") {
      const built = buildPricing(parsed, rules, { amount: v, currency: p?.cogs_currency ?? "USD" });
      if (built) save({ ...built, source: "manual" });
      return;
    }
    if (!p) return;
    if (v === p[field]) return;
    if (field === "price") {
      save({ ...p, price: v, compare_at: compareAtFor(v, rules), fit: fitFor(v, p.band), source: "manual", at: new Date().toISOString() });
    } else {
      save({ ...p, compare_at: v, source: "manual", at: new Date().toISOString() });
    }
  };

  const reset = () => {
    if (!p) return;
    const built = buildPricing(parsed, rules, { amount: p.cogs, currency: p.cogs_currency });
    if (built) save({ ...built, cogs_source: p.cogs_source });
  };

  if (!parsed) return null;

  const cur = p?.cogs_currency ?? "USD";
  const fmt = (x: number) => fmtMoney(x, cur);
  const warnings = p ? pricingWarnings(p, p.band, rules) : [];
  const fitColor = p?.fit === "in range" ? "text-[var(--color-green)] border-[var(--color-green)]/50"
    : p?.fit ? "text-[var(--color-amber)] border-[var(--color-amber)]/50" : "";
  const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const pct = p?.band ? Math.round(((p.price - p.band.median) / p.band.median) * 100) : 0;

  const field = (key: "cogs" | "price" | "compare_at", label: string, extra?: React.ReactNode) => (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="eyebrow">{label}</span>
        {extra}
      </div>
      <input
        value={draft[key]}
        inputMode="decimal"
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => commit(key)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="0.00"
        className="w-full px-[11px] py-2 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] ff-mono text-[15px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-4)]"
      />
    </div>
  );

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Pricing</span>
        {p?.fit && <span className={`ff-mono text-[10px] uppercase tracking-wide border rounded-full px-2 py-0.5 ${fitColor}`}>{p.fit}</span>}
        {p?.source === "manual" && <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">edited</span>}
        <div className="flex-1" />
        {p && <button onClick={reset} className="btn btn-sm">Reset to rules</button>}
      </div>
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {field("cogs", "COGS", (
            <span className={`ff-mono text-[9.5px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${cur === "USD" ? "text-[var(--color-text-4)] border-[var(--color-border)]" : "text-[var(--color-amber)] border-[var(--color-amber)]/50"}`}>{cur}</span>
          ))}
          {field("price", "Price")}
          {field("compare_at", "Compare at")}
        </div>
        {p && (
          <p className="ff-mono text-[11px] text-[var(--color-text-3)]">
            {(p.price / p.cogs).toFixed(1)}× COGS · {fmt(round2(p.price - p.cogs))} margin · compare-at +{fmt(round2(p.compare_at - p.price))}
          </p>
        )}
        <div className="border-t border-[var(--color-border)] pt-3">
          {p?.band ? (
            <p className="ff-mono text-[11px] text-[var(--color-text-2)]">
              Competitors {fmt(p.band.low)} – {fmt(p.band.high)} · median {fmt(p.band.median)} · yours {Math.abs(pct)}% {pct <= 0 ? "under" : "over"} median
            </p>
          ) : (
            <p className="ff-mono text-[11px] text-[var(--color-text-4)]">No competitor prices</p>
          )}
          {p && p.competitors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {p.competitors.map((c) => (
                <a key={c.url} href={c.url} target="_blank" rel="noreferrer"
                  className={`ff-mono text-[10.5px] rounded-full border px-2 py-0.5 ${c.currency === cur ? "text-[var(--color-text-2)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]" : "text-[var(--color-text-4)] border-[var(--color-border)] opacity-60"}`}>
                  {domain(c.url)} · {fmtMoney(c.price, c.currency)}
                </a>
              ))}
            </div>
          )}
        </div>
        {warnings.length > 0 && (
          <ul className="space-y-0.5">
            {warnings.map((w) => <li key={w} className="text-[11.5px] text-[var(--color-red)]">{w}</li>)}
          </ul>
        )}
        {err && <p className="text-[11.5px] text-[var(--color-red)]">{err}</p>}
      </div>
    </div>
  );
}
