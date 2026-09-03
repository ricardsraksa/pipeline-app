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
export default function VariantsCard({ scrape, rules, band = null }: {
  scrape: string | null;
  rules?: PricingRules;
  band?: MarketBand | null;
}) {
  const parsed = useMemo(() => parseProductScrape(scrape), [scrape]);
  const [fetched, setFetched] = useState<PricingRules | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (rules) return;
    fetch("/api/settings/pricing").then((r) => r.json()).then((d: { rules?: PricingRules }) => { if (d.rules) setFetched(d.rules); }).catch(() => {});
  }, [rules]);
  const R = rules ?? fetched ?? DEFAULT_PRICING_RULES;

  const page = parsed?.pages.find((p) => p.role === "product" && p.ok);
  const options = page?.options ?? {};
  const variants = page?.variants ?? [];
  const groups = Object.entries(options).filter(([, vals]) => vals.length);
  if (!page || (!groups.length && !variants.length)) return null;

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1200); }).catch(() => {});
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Variants</span>
        <span className="ff-mono text-[10.5px] text-[var(--color-text-3)]">
          {groups.length} option{groups.length === 1 ? "" : "s"}{variants.length ? ` · ${variants.length} SKU${variants.length === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] px-[13px] py-3 space-y-3">
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
