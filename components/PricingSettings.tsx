"use client";

import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { SettingsHandle } from "@/components/ModelSettings";
import { DEFAULT_PRICING_RULES, parseBundleDiscounts, validateRules, type PricingRules } from "@/lib/pricing";

type Field = Exclude<keyof PricingRules, "bundle_discounts">;
const FIELDS: Array<{ key: Field; label: string; step: string }> = [
  { key: "min_multiple", label: "Minimum multiple of COGS", step: "0.5" },
  { key: "ending", label: "Price ending", step: "0.01" },
  { key: "compare_at_min", label: "Compare-at above price · min ($)", step: "1" },
  { key: "compare_at_max", label: "Compare-at above price · max ($)", step: "1" },
];

const fmtDiscounts = (d: number[]) => d.map((x) => String(Math.round(x * 100))).join(", ");

// Settings block for the pricing rules used by the Stage 3 Pricing card.
export default function PricingSettings({ ref, onDirtyChange }: { ref?: React.Ref<SettingsHandle>; onDirtyChange?: (n: number) => void }) {
  const [saved, setSaved] = useState<PricingRules | null>(null);
  const [draft, setDraft] = useState<Record<Field, string>>({ min_multiple: "", ending: "", compare_at_min: "", compare_at_max: "" });
  const [bundleText, setBundleText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = (r: PricingRules) => {
    setSaved(r);
    setDraft({ min_multiple: String(r.min_multiple), ending: r.ending.toFixed(2), compare_at_min: String(r.compare_at_min), compare_at_max: String(r.compare_at_max) });
    setBundleText(fmtDiscounts(r.bundle_discounts));
  };

  const load = useCallback(() => {
    setLoading(true); setLoadErr(false);
    fetch("/api/settings/pricing")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { rules?: PricingRules }) => { if (d.rules) apply(d.rules); else setLoadErr(true); })
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const bundle_discounts = parseBundleDiscounts(bundleText);
  const parsed: PricingRules = {
    min_multiple: Number(draft.min_multiple),
    ending: Number(draft.ending),
    compare_at_min: Number(draft.compare_at_min),
    compare_at_max: Number(draft.compare_at_max),
    bundle_discounts: bundle_discounts ?? [],
  };
  const invalid = bundle_discounts ? validateRules(parsed) : "Bundle discounts: invalid";
  const dirtyCount = !saved ? 0
    : FIELDS.filter((f) => parsed[f.key] !== saved[f.key]).length + (fmtDiscounts(parsed.bundle_discounts) !== fmtDiscounts(saved.bundle_discounts) ? 1 : 0);
  const dirty = dirtyCount > 0;
  useEffect(() => { onDirtyChange?.(dirtyCount); }, [dirtyCount, onDirtyChange]);

  async function save(): Promise<boolean> {
    if (invalid) return false;
    setSaving(true); setOk(false); setErr(null);
    try {
      const res = await fetch("/api/settings/pricing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { setErr(data.error ?? "Save failed."); return false; }
      apply(data.rules);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
      return true;
    } catch {
      setErr("Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (saved) apply(saved);
    setErr(null);
  }

  useImperativeHandle(ref, () => ({ save: () => (dirty ? save() : Promise.resolve(true)), discard }));

  return (
    <section className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] overflow-hidden">
      <div className="px-5 py-4">
        {loading ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading…</p>
        ) : loadErr ? (
          <div className="flex items-center gap-3">
            <p className="text-[12.5px] text-[var(--color-red)]">Couldn&apos;t load.</p>
            <button onClick={load} className="btn btn-sm">Retry</button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {FIELDS.map((f) => {
              const isDefault = parsed[f.key] === DEFAULT_PRICING_RULES[f.key];
              return (
                <div key={f.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-[600] text-[var(--color-text)]">{f.label}</p>
                      {isDefault ? (
                        <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">default</span>
                      ) : (
                        <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-amber)] bg-[var(--color-amber-bg)] rounded px-1.5 py-0.5">custom</span>
                      )}
                    </div>
                    <p className="text-[10.5px] text-[var(--color-text-4)] mt-0.5 font-[var(--font-ibm-plex-mono)]">Default: {f.key === "ending" ? DEFAULT_PRICING_RULES.ending.toFixed(2) : DEFAULT_PRICING_RULES[f.key]}</p>
                  </div>
                  <input
                    type="number" inputMode="decimal" step={f.step} value={draft[f.key]} aria-label={f.label}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="w-[110px] shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] ff-mono text-[12.5px] px-3 py-2 text-right focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-[600] text-[var(--color-text)]">Bundle discounts per item (%)</p>
                  {fmtDiscounts(parsed.bundle_discounts) === fmtDiscounts(DEFAULT_PRICING_RULES.bundle_discounts) ? (
                    <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">default</span>
                  ) : (
                    <span className="font-[var(--font-ibm-plex-mono)] text-[9px] uppercase tracking-wider text-[var(--color-amber)] bg-[var(--color-amber-bg)] rounded px-1.5 py-0.5">custom</span>
                  )}
                </div>
                <p className="text-[10.5px] text-[var(--color-text-4)] mt-0.5 font-[var(--font-ibm-plex-mono)]">Default: {fmtDiscounts(DEFAULT_PRICING_RULES.bundle_discounts)}</p>
              </div>
              <input
                type="text" inputMode="decimal" value={bundleText} aria-label="Bundle discounts per item (%)"
                onChange={(e) => setBundleText(e.target.value)}
                className="w-[110px] shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] ff-mono text-[12.5px] px-3 py-2 text-right focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          </div>
        )}
        {(err || (dirty && invalid)) && <p className="text-[11.5px] text-[var(--color-red)] mt-3">{err ?? invalid}</p>}
        {!loading && !loadErr && (
          <div className="flex items-center gap-3 mt-4">
            <button onClick={save} disabled={saving || !dirty || !!invalid} className="btn btn-primary">
              {saving ? "Saving…" : "Save"}
            </button>
            {dirty && !saving && <button onClick={discard} className="btn">Discard</button>}
            {ok && (
              <span className="inline-flex items-center gap-1.5 text-xs font-[620] text-[var(--color-green)]">
                <Icon.Check className="w-3 h-3" /> Saved
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
