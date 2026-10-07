import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { shopifyConfigured } from "@/lib/shopify";
import { describeTemplate, getTemplateUrl, setTemplateUrl } from "@/lib/shopify/template";

// The template product new runs are copied from (lib/shopify/template.ts).
export async function GET(req: Request) {
  const denied = requireSession(req); if (denied) return denied;
  const url = await getTemplateUrl();
  // ?lite=1: just whether a template is set (the run page asks on every load).
  if (new URL(req.url).searchParams.get("lite")) return NextResponse.json({ url });
  if (!url) return NextResponse.json({ configured: shopifyConfigured(), url: null, info: null });
  try {
    return NextResponse.json({ configured: shopifyConfigured(), url, info: await describeTemplate(url) });
  } catch (e) {
    return NextResponse.json({ configured: shopifyConfigured(), url, info: null, error: e instanceof Error ? e.message : String(e) });
  }
}

// Body: { url: string | null } — checked against the store before it is saved.
export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  let body: { url?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.url !== null && typeof body.url !== "string") return NextResponse.json({ error: "url must be a product link or null" }, { status: 400 });
  try {
    const info = await setTemplateUrl(body.url ?? null);
    return NextResponse.json({ success: true, url: info ? body.url : null, info });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't use that product" }, { status: 400 });
  }
}
