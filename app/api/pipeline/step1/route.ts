import { NextRequest } from "next/server";
import {
  runIdentify,
  runMarket,
  runCompetitive,
  runProductAnalysis,
  runVisual,
  type ResearchInputs,
} from "@/lib/research/runner";

export const maxDuration = 300; // 5 min — these 5 calls can take a while

export async function POST(req: NextRequest) {
  const body = await req.json();
  const inputs: ResearchInputs = {
    product_url: body.product_url,
    product_description: body.product_description,
    scraped_text: body.scraped_text,
    competitor_urls: body.competitor_urls,
    competitor_scraped: body.competitor_scraped,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // ── 1. Identify ──────────────────────────────────────────────────────
        emit({ type: "progress", substep: "identify_running" });
        const identify = await runIdentify(inputs);
        emit({ type: "progress", substep: "identify_done" });

        // ── 2. Market ────────────────────────────────────────────────────────
        emit({ type: "progress", substep: "market_running" });
        const market = await runMarket(inputs, identify);
        emit({ type: "progress", substep: "market_done" });

        // ── 3. Competitive ───────────────────────────────────────────────────
        emit({ type: "progress", substep: "competitive_running" });
        const competitive = await runCompetitive(inputs, identify, market);
        emit({ type: "progress", substep: "competitive_done" });

        // ── 4. Product Analysis ──────────────────────────────────────────────
        emit({ type: "progress", substep: "product_running" });
        const productAnalysis = await runProductAnalysis(inputs, identify, market, competitive);
        emit({ type: "progress", substep: "product_done" });

        // ── 5. Visual Strategy ───────────────────────────────────────────────
        emit({ type: "progress", substep: "visual_running" });
        const visual = await runVisual(inputs, identify, market, competitive);
        emit({ type: "progress", substep: "visual_done" });

        // ── Merge into RESEARCH.txt ──────────────────────────────────────────
        const output = [identify, market, competitive, productAnalysis, visual]
          .filter(Boolean)
          .join("\n\n");

        emit({ type: "done", output, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message, success: false });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
