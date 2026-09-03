import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { DEFAULT_PRICING_RULES } from "@/lib/pricing";
import { getPricingRules, setPricingRules } from "@/lib/pricing-store";

export async function GET(req: Request) {
  const denied = requireSession(req); if (denied) return denied;
  return NextResponse.json({ rules: await getPricingRules(), defaults: DEFAULT_PRICING_RULES });
}

// Body: { rules: PricingRules }
export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  let body: { rules?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const rules = await setPricingRules(body.rules);
    return NextResponse.json({ success: true, rules, defaults: DEFAULT_PRICING_RULES });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed" }, { status: 400 });
  }
}
