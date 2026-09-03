"use client";

import { useEffect, useMemo, useState } from "react";
import { parseProductScrape } from "@/lib/product";
import {
  DEFAULT_PRICING_RULES, compareAtFor, fmtMoney, parseMoney, suggestPrice,
  type MarketBand, type PricingRules,
} from "@/lib/pricing";

// The variants to set up in Shopify, read from the AliExpress listing: every
// option group with its values, and each SKU with its supplier price and the
// price the rules give it. Display only.
export default function VariantsCard({ runId, scrape, rules, band = null, requestedAt = null }: {
  runId: number;
  scrape: string | null;
  rules?: PricingRules;
  band?: MarketBand | null;
  /** Set while a re-read is waiting for the Mac worker. */
  requestedAt?: string | null;
}) {
  const parsed = useMemo(() => parseProductScrape(scrape), [scrape]);
  const [fetched, setFetched] = useState<PricingRules | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<string | null>(requestedAt);
  const [askErr, setAskErr] = useState<string | null>(null);
  useEffect(() => { setAsked(requestedAt); }, [requestedAt]);
  const reread = async () => {
    setAsking(true); setAskErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}/variants-refresh`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { setAskErr(d.error || `Failed (${r.status})`); return; }
      setAsked(d.requested_at as string);
    } catch { setAskErr("Network error"); }
    finally { setAsking(false); }
  };
  useEffect(() => {
    if (rules) return;
    fetch("/api/settings/pricing").then((r) => r.json()).then((d: { rules?: PricingRules }) => { if (d.rules) setFetched(d.rules); }).catch(() => {});
  }, [rules]);
  const R = rules ?? fetched ?? DEFAULT_PRICING_RULES;

  const page = parsed?.pages.find((p) => p.role === "product");
  const options = page?.options ?? {};
  const variants = page?.variants ?? [];
  const groups = Object.entries(options).filter(([, vals]) => vals.length);
  if (!parsed) return null;
  const empty = !groups.length && !variants.length;

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1200); }).catch(() => {});
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Variants</span>
        <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">
          {empty ? "none read from the listing" : `${groups.length} option${groups.length === 1 ? "" : "s"}${variants.length ? ` · ${variants.length} SKU${variants.length === 1 ? "" : "s"}` : ""}`}
        </span>
        <div className="flex-1" />
        {asked
          ? <span className="ff-mono text-[10.5px] text-[var(--color-amber)]" title="The Mac worker picks this up on its next poll (about 20 s) and re-reads the listing">re-reading on your Mac…</span>
          : <button onClick={reread} disabled={asking} className="btn btn-sm">{asking ? "Requesting…" : "Re-read listing"}</button>}
      </div>
      {askErr && <p className="text-[11.5px] text-[var(--color-red)] mb-2">{askErr}</p>}
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 space-y-3">
        {empty && <p className="ff-mono text-[11px] text-[var(--color-text-4)]">No option groups or SKUs in the stored scrape.</p>}
        {groups.map(([name, vals]) => (
          <div key={name} className="flex items-start gap-3">
            <div className="w-[110px] shrink-0 pt-0.5">
              <p className="text-[12.5px] font-[600] text-[var(--color-text)] truncate" title={name}>{name}</p>
              <button onClick={() => copy(name, vals.join(", "))} className="ff-mono text-[10px] text-[var(--color-text-4)] hover:text-[var(--color-text-2)] cursor-pointer">
                {copied === name ? "copied" : "copy values"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {vals.map((v) => (
                <span key={v} className="ff-mono text-[11px] text-[var(--color-text-2)] border border-[var(--color-border)] rounded-full px-2 py-0.5">{v}</span>
              ))}
            </div>
          </div>
        ))}
        {variants.length > 0 && (
          <div className={groups.length ? "border-t border-[var(--color-border)] pt-3" : ""}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="ff-mono text-[10px] uppercase tracking-wide text-[var(--color-text-4)]">
                    <th className="text-left font-[500] pb-1.5">SKU</th>
                    <th className="text-right font-[500] pb-1.5 pl-3">AliExpress</th>
                    <th className="text-right font-[500] pb-1.5 pl-3">Price</th>
                    <th className="text-right font-[500] pb-1.5 pl-3">Compare at</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => {
                    const m = parseMoney(v.price);
                    const sold = v.available === false;
                    const s = m ? suggestPrice(m.amount, band, R) : null;
                    return (
                      <tr key={`${v.title ?? ""}-${i}`} className={`border-t border-[var(--color-border)] ${sold ? "opacity-50" : ""}`}>
                        <td className="py-1.5 pr-3 text-[var(--color-text)]">{v.title || `SKU ${i + 1}`}{sold ? <span className="ff-mono text-[10px] text-[var(--color-text-4)]"> · sold out</span> : null}</td>
                        <td className="py-1.5 pl-3 text-right ff-mono text-[var(--color-text-2)] whitespace-nowrap">{m ? fmtMoney(m.amount, m.currency) : "—"}</td>
                        <td className="py-1.5 pl-3 text-right ff-mono text-[var(--color-text)] whitespace-nowrap">{s ? fmtMoney(s.price, m!.currency) : "—"}</td>
                        <td className="py-1.5 pl-3 text-right ff-mono text-[var(--color-text-2)] whitespace-nowrap">{s ? fmtMoney(compareAtFor(s.price, R), m!.currency) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
