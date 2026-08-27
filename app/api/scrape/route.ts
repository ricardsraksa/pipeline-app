import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { scrapeProduct } from "@/lib/scrape";

// Thin wrapper: the scrape logic lives in lib/scrape.ts so the pipeline runner
// can call it directly (no HTTP hop, no auth-gate self-401).
export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  const { url } = await req.json();
  const result = await scrapeProduct(url);
  if (!result.success && (result.error === "URL required" || result.error === "URL too long" || /blocked|not allowed|invalid url|could not resolve/i.test(result.error))) {
    return Response.json(result, { status: 400 });
  }
  return Response.json(result);
}
