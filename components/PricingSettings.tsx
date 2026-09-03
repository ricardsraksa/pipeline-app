"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { DEFAULT_PRICING_RULES, validateRules, type PricingRules } from "@/lib/pricing";

type Field = keyof PricingRules;
const FIELDS: Array<{ key: Field; label: string; step: string }> = [
  { key: "min_multiple", label: "Minimum multiple of COGS", step: "0.5" },
  { key: "ending", label: "Price ending", step: "0.01" },
  { key: "compare_at_min", label: "Compare-at above price · min ($)", step: "1" },
  { key: "compare_at_max", label: "Compare-at above price · max ($)", step: "1" },
];

// Settings block for the pricing rules used by the Stage 3 Pricing card.
export default function PricingSettings() {
  const [saved, setSaved] = useState<PricingRules | null>(null);
  const [draft, setDraft] = useState<Record<Field, string>>({ min_multiple: "", ending: "", compare_at_min: "", compare_at_max: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = (r: PricingRules) => {
    setSaved(r);
    setDraft({ min_multiple: String(r.min_multiple), ending: r.ending.toFixed(2), compare_at_min: String(r.compare_at_min), compare_at_max: String(r.compare_at_max) });
  };

  useEffect(() => {
    fetch("/api/settings/pricing")
      .then((r) => r.json())
      .then((d: { rules?: PricingRules }) => { if (d.rules) apply(d.rules); })
      .catch(() => setErr("Couldn't load pricing rules."))
      .finally(() => setLoading(false));
  }, []);

  const parsed: PricingRules = {
    min_multiple: Number(draft.min_multiple),
    ending: Number(draft.ending),
    compare_at_min: Number(draft.compare_at_min),
    compare_at_max: Number(draft.compare_at_max),
  };
  const invalid = validateRules(parsed);
  const dirty = !!saved && FIELDS.some((f) => parsed[f.key] !== saved[f.key]);

  async function save() {
    setSaving(true); setOk(false); setErr(null);
    try {
      const res = await fetch("/api/settings/pricing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: parsed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setErr(data.error ?? "Save failed"); return; }
      apply(data.rules);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-[var(--color-border)] rounded-[9px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] overflow-hidden mb-5">
      <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2.5">
          <span className="font-[var(--font-ibm-plex-mono)] text-[9px] text-[var(--color-text-4)] border border-[var(--color-border)] rounded px-1.5 py-0.5">$</span>
          <h3 className="text-[13px] font-[600] text-[var(--color-text-2)]">Pricing rules</h3>
        </div>
        {ok && (
          <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-green-bg)] text-[var(--color-green)] whitespace-nowrap">
            <Icon.Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <p className="font-[var(--font-ibm-plex-mono)] text-[11px] text-[var(--color-text-3)]">Loading…</p>
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
                    type="number" inputMode="decimal" step={f.step} value={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="w-[110px] shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] ff-mono text-[12.5px] px-3 py-2 text-right focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              );
            })}
          </div>
        )}
        {(err || (dirty && invalid)) && <p className="text-[11.5px] text-[var(--color-red)] mt-3">{err ?? invalid}</p>}
        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={saving || !dirty || !!invalid} className="btn btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}
