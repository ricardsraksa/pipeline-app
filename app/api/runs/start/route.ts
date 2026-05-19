import { NextRequest, NextResponse } from "next/server";
import { createRun } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline-runner";

export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    url?: string;
    productDescription?: string;
    competitorUrls?: string[];
  };

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "URL required" }, { status: 400 });
  }

  const runId = await createRun({
    product_url: url,
    product_description: body.productDescription ?? null,
    competitor_urls: body.competitorUrls?.filter(Boolean) ?? null,
    status: "pending",
  });

  // Fire-and-forget: pipeline runs in background
  runPipeline(runId).catch((err) => {
    console.error(`Pipeline ${runId} failed:`, err);
  });

  return NextResponse.json({ runId });
}
