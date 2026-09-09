"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseProductScrape } from "@/lib/product";
import {
  buildBundles, buildPricing, bundleWarnings, compareAtFor, defaultQtys, fitFor, fmtMoney, pricingWarnings,
  rebuildBundles, round2, tierCompareAt, tierPrice,
  type Bundles, type BundleTier, type PricingRules, type ProductPricing,
} from "@/lib/pricing";

// Suggested retail price for the run: rules (× COGS, .95 ending, compare-at
// bump) against the competitor prices the scrape read, plus the bundle ladder
// (Kaching-style quantity tiers) derived from it. Lives on Stage 3 above the
// copy kit; edits persist on the run. Nothing downstream reads it.
export default function PricingCard({ runId, scrape, pricing, rules }: {
  runId: number;
  scrape: string | null;
  pricing: ProductPricing | null;
  rules: PricingRules;
}) {
  const parsed = useMemo(() => parseProductScrape(scrape), [scrape]);
  const [p, setP] = useState<ProductPricing | null>(() => pricing ?? (parsed ? buildPricing(parsed, rules) : null));
  const [err, setErr] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  // Server value wins only when it is newer than what we hold (polling
  // delivers our own saves back; an older row must not undo a fresh edit).
  useEffect(() => {
    if (pricing && (!p || pricing.at > p.at)) setP(pricing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing]);

  const save = (next: ProductPricing): Promise<boolean> => {
    setP(next);
    setErr(null);
    return fetch(`/api/runs/${runId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_pricing: JSON.stringify(next) }),
    })
      .then(async (r) => {
        if (r.ok) return true;
        const d = await r.json().catch(() => ({}));
        setErr((d as { error?: string }).error || `Could not save (${r.status})`);
        return false;
      })
      .catch(() => { setErr("Network error saving pricing"); return false; });
  };

  // The quantity suggestion. `note` undefined = the automatic first run (hand-
  // typed tiers survive); a string = "Suggest again" (every tier rebuilt).
  const suggest = async (n?: string) => {
    setSuggesting(true);
    setErr(null);
    try {
      const r = await fetch("/api/pricing/bundles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n === undefined ? { runId } : { runId, note: n }),
      });
      const d = await r.json().catch(() => ({})) as { success?: boolean; pricing?: ProductPricing; error?: string };
      if (d.success && d.pricing) setP(d.pricing);
      else setErr(d.error || `Suggestion failed (${r.status})`);
    } catch {
      setErr("Network error asking for quantities");
    } finally {
      setSuggesting(false);
    }
  };

  // First mount: persist the auto suggestion once (so the rail row appears
  // without a click), give older rows a ladder, then ask for quantities once
  // per run — `ai_at` on the stored block is the "already asked" mark.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || !p) return;
    booted.current = true;
    void (async () => {
      let cur = p;
      if (!pricing) {
        if (!(await save(cur))) return;
      } else if (!cur.bundles) {
        cur = { ...cur, bundles: buildBundles(cur, defaultQtys(rules), rules, { source: "rules" }), at: new Date().toISOString() };
        if (!(await save(cur))) return;
      }
      if (!cur.bundles?.ai_at) await suggest();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text drafts for the inputs; re-seeded whenever the pricing changes.
  const [draft, setDraft] = useState({ cogs: "", price: "", compare_at: "" });
  const [tierDraft, setTierDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft({ cogs: p ? p.cogs.toFixed(2) : "", price: p ? p.price.toFixed(2) : "", compare_at: p ? p.compare_at.toFixed(2) : "" });
    const td: Record<string, string> = {};
    (p?.bundles?.tiers ?? []).forEach((t, i) => {
      td[`${i}.qty`] = String(t.qty);
      td[`${i}.discount`] = String(Math.round(t.discount * 100));
      td[`${i}.price`] = t.price.toFixed(2);
      td[`${i}.compare_at`] = t.compare_at.toFixed(2);
    });
    setTierDraft(td);
  }, [p]);

  const withBundles = (next: ProductPricing, bundles: Bundles | undefined): ProductPricing =>
    bundles ? { ...next, bundles: rebuildBundles(bundles, next, rules) } : next;

  const commit = (field: "cogs" | "price" | "compare_at") => {
    const v = round2(Number(draft[field].replace(",", ".")));
    if (!Number.isFinite(v) || v <= 0) { setDraft((d) => ({ ...d, [field]: p ? p[field].toFixed(2) : "" })); return; }
    if (field === "cogs") {
      const built = buildPricing(parsed, rules, { amount: v, currency: p?.cogs_currency ?? "USD" });
      if (built) save({ ...withBundles(built, p?.bundles), source: "manual" });
      return;
    }
    if (!p) return;
    if (v === p[field]) return;
    if (field === "price") {
      save(withBundles({ ...p, price: v, compare_at: compareAtFor(v, rules), fit: fitFor(v, p.band), source: "manual", at: new Date().toISOString() }, p.bundles));
    } else {
      save(withBundles({ ...p, compare_at: v, source: "manual", at: new Date().toISOString() }, p.bundles));
    }
  };

  const reset = () => {
    if (!p) return;
    const built = buildPricing(parsed, rules, { amount: p.cogs, currency: p.cogs_currency });
    if (!built) return;
    // Single back to the rules; tiers keep their quantities and discounts.
    const tiers = p.bundles ? { ...p.bundles, tiers: p.bundles.tiers.map((t) => ({ ...t, manual: false })) } : undefined;
    save({ ...withBundles(built, tiers), cogs_source: p.cogs_source });
  };

  const commitTier = (i: number, field: keyof Pick<BundleTier, "qty" | "discount" | "price" | "compare_at">) => {
    if (!p?.bundles) return;
    const key = `${i}.${field}`;
    const t = p.bundles.tiers[i];
    if (!t) return;
    const revert = () => setTierDraft((d) => ({ ...d, [key]: field === "qty" ? String(t.qty) : field === "discount" ? String(Math.round(t.discount * 100)) : t[field].toFixed(2) }));
    const raw = Number((tierDraft[key] ?? "").replace(",", ".").replace("%", ""));
    if (!Number.isFinite(raw)) { revert(); return; }
    const tiers = p.bundles.tiers.map((x) => ({ ...x }));
    if (field === "qty") {
      const q = Math.round(raw);
      const prev = tiers[i - 1]?.qty ?? 0, next = tiers[i + 1]?.qty ?? Infinity;
      if (q < 1 || q <= prev || q >= next || q === t.qty) { revert(); return; }
      tiers[i] = { qty: q, discount: t.discount, price: tierPrice(p.price, q, t.discount, rules), compare_at: tierCompareAt(p.compare_at, q) };
    } else if (field === "discount") {
      const d = round2(raw / 100);
      if (d < 0 || d >= 0.9 || d === t.discount) { revert(); return; }
      tiers[i] = { qty: t.qty, discount: d, price: tierPrice(p.price, t.qty, d, rules), compare_at: tierCompareAt(p.compare_at, t.qty) };
    } else {
      const v = round2(raw);
      if (v <= 0 || v === t[field]) { revert(); return; }
      tiers[i] = { ...t, [field]: v, manual: true };
    }
    save({ ...p, bundles: { ...p.bundles, tiers, source: "manual", at: new Date().toISOString() }, at: new Date().toISOString() });
  };

  const resetBundles = () => {
    if (!p) return;
    const fresh = buildBundles(p, defaultQtys(rules), rules, { source: "rules", ai_at: p.bundles?.ai_at });
    save({ ...p, bundles: fresh, at: new Date().toISOString() });
  };

  if (!parsed) return null;

  const cur = p?.cogs_currency ?? "USD";
  const fmt = (x: number) => fmtMoney(x, cur);
  const warnings = p ? [...pricingWarnings(p, p.band, rules), ...bundleWarnings(p, rules)] : [];
  const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const pct = p?.band ? Math.round(((p.price - p.band.median) / p.band.median) * 100) : 0;
  const tiers = p?.bundles?.tiers ?? [];
  const tiersEdited = tiers.some((t) => t.manual) || p?.bundles?.source === "manual";

  const inputCls = "w-full px-[11px] py-2 rounded-[8px] bg-[var(--color-surface)] border border-[var(--color-border)] ff-mono text-[15px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-4)]";
  const tierInputCls = "w-full px-2 py-1.5 rounded-[7px] bg-[var(--color-surface)] border border-[var(--color-border)] ff-mono text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)] text-right";

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
        className={inputCls}
      />
    </div>
  );

  const tierField = (i: number, key: "qty" | "discount" | "price" | "compare_at") => (
    <input
      value={tierDraft[`${i}.${key}`] ?? ""}
      inputMode={key === "qty" ? "numeric" : "decimal"}
      onChange={(e) => setTierDraft((d) => ({ ...d, [`${i}.${key}`]: e.target.value }))}
      onBlur={() => commitTier(i, key)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={tierInputCls}
      aria-label={`${key} tier ${i + 1}`}
    />
  );

  const tierCols = { gridTemplateColumns: "64px 64px 1fr 1fr 84px 52px" } as const;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3.5 mb-2.5">
        <span className="eyebrow">Pricing</span>
        {p?.source === "manual" && <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">edited</span>}
        <div className="flex-1" />
        {p && <button onClick={reset} className="btn btn-sm cursor-pointer">Reset to rules</button>}
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

        {p && tiers.length > 0 && (
          <div className="border-t border-[var(--color-border)] pt-3">
            <div className="flex items-center gap-3.5 mb-2">
              <span className="eyebrow">Bundles</span>
              {tiersEdited && <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">edited</span>}
              {suggesting && <span className="ff-mono text-[10.5px] text-[var(--color-text-4)]">…</span>}
              <div className="flex-1" />
              <button onClick={() => setNoteOpen((o) => !o)} disabled={suggesting} className="btn btn-sm cursor-pointer">Suggest again</button>
              <button onClick={resetBundles} disabled={suggesting} className="btn btn-sm cursor-pointer">Reset</button>
            </div>
            {noteOpen && (
              <input
                value={note}
                autoFocus
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { setNoteOpen(false); void suggest(note.trim()); }
                  if (e.key === "Escape") setNoteOpen(false);
                }}
                className={`${inputCls} mb-2 text-[13px]`}
              />
            )}
            <div className="grid gap-x-2 gap-y-1.5 items-center" style={tierCols}>
              <span className="eyebrow text-right">Qty</span>
              <span className="eyebrow text-right">Off %</span>
              <span className="eyebrow text-right">Price</span>
              <span className="eyebrow text-right">Compare at</span>
              <span className="eyebrow text-right">Per item</span>
              <span className="eyebrow text-right">×</span>
              {tiers.map((t, i) => (
                <TierRow key={i} i={i} t={t} cogs={p.cogs} fmt={fmt} tierField={tierField} />
              ))}
            </div>
          </div>
        )}

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

function TierRow({ i, t, cogs, fmt, tierField }: {
  i: number;
  t: BundleTier;
  cogs: number;
  fmt: (x: number) => string;
  tierField: (i: number, key: "qty" | "discount" | "price" | "compare_at") => React.ReactNode;
}) {
  const unit = t.price / t.qty;
  return (
    <>
      {tierField(i, "qty")}
      {tierField(i, "discount")}
      {tierField(i, "price")}
      {tierField(i, "compare_at")}
      <span className={`ff-mono text-[12px] text-right ${t.manual ? "text-[var(--color-text)]" : "text-[var(--color-text-2)]"}`}>{fmt(round2(unit))}</span>
      <span className="ff-mono text-[12px] text-right text-[var(--color-text-3)]">{(unit / cogs).toFixed(1)}×</span>
    </>
  );
}
