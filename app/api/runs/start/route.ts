import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createRun } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline-runner";

import { requireSession } from "@/lib/auth";
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json()) as {
    productDescription?: string;
    sourceImages?: string[];
    productUrl?: string;
    competitorUrls?: string[];
    productCode?: string;
    // Back-compat alias from the old form (treated the same as productUrl)
    url?: string;
  };

  const productDescription = body.productDescription?.trim() ?? "";
  if (productDescription.length < 20) {
    return NextResponse.json(
      { error: "Product description required (minimum 20 characters)" },
      { status: 400 }
    );
  }
  // Upper cap: anything past this is abuse, not a description — it would bloat
  // the DB row and the downstream LLM prompt (and its cost).
  if (productDescription.length > 20000) {
    return NextResponse.json(
      { error: "Product description too long (max 20,000 characters)" },
      { status: 400 }
    );
  }

  const sourceImages = Array.isArray(body.sourceImages)
    ? body.sourceImages.filter((s): s is string => typeof s === "string" && !!s && s.length <= 2048)
    : [];
  if (sourceImages.length === 0) {
    return NextResponse.json(
      { error: "At least one source image required" },
      { status: 400 }
    );
  }
  if (sourceImages.length > 10) {
    return NextResponse.json({ error: "Max 10 source images" }, { status: 400 });
  }

  const productUrl = (body.productUrl ?? body.url ?? "").trim();
  if (productUrl.length > 2048) {
    return NextResponse.json({ error: "Product URL too long" }, { status: 400 });
  }
  const competitorUrls = Array.isArray(body.competitorUrls)
    ? body.competitorUrls.map((u) => u.trim()).filter((u) => !!u && u.length <= 2048).slice(0, 5)
    : [];

  const runId = await createRun({
    product_url: productUrl || null,
    product_description: productDescription,
    competitor_urls: competitorUrls.length ? competitorUrls : null,
    uploaded_source_images: sourceImages,
    product_code: body.productCode?.trim().slice(0, 100) || null,
    status: "pending",
  });

  // Invalidate any cached /history payload so the new run shows immediately
  // when the user navigates there.
  revalidatePath("/history");

  // Fire-and-forget: pipeline runs in background
  runPipeline(runId).catch((err) => {
    console.error(`Pipeline ${runId} failed:`, err);
  });

  return NextResponse.json({ runId });
}
