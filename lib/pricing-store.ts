// Server-side home of the pricing rules (Settings → Pricing). One JSON blob
// in app_kv; defaults from lib/pricing.ts when nothing is saved.
import { getKV, setKV } from "@/lib/db";
import { DEFAULT_PRICING_RULES, normalizeRules, validateRules, type PricingRules } from "@/lib/pricing";

const KV_KEY = "pricing_rules";

export async function getPricingRules(): Promise<PricingRules> {
  try {
    const raw = await getKV(KV_KEY);
    return raw ? normalizeRules(JSON.parse(raw)) : { ...DEFAULT_PRICING_RULES };
  } catch {
    return { ...DEFAULT_PRICING_RULES };
  }
}

export async function setPricingRules(rules: unknown): Promise<PricingRules> {
  const err = validateRules(rules);
  if (err) throw new Error(err);
  const clean = normalizeRules(rules);
  await setKV(KV_KEY, JSON.stringify(clean));
  return clean;
}
