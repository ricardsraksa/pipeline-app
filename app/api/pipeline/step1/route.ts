import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { RESEARCH_PROMPT } from "@/lib/prompts/research";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { product_url, product_description, scraped_text, competitor_urls, competitor_scraped } = await req.json();

  const competitorUrlsBlock = competitor_urls?.length
    ? competitor_urls.join("\n")
    : "None provided";

  const competitorDataBlock = competitor_scraped?.length
    ? competitor_scraped
        .map((c: { url: string; text: string }) => `Competitor: ${c.url}\nContent: ${c.text.slice(0, 1500)}\n`)
        .join("\n")
    : "(not available)";

  const productDescriptionBlock = product_description?.trim()
    ? product_description.trim()
    : "Not provided — use scraped data as the source";

  const userMessage = [
    `PRODUCT URL: ${product_url}`,
    `\nPRODUCT DESCRIPTION (user-provided ground truth):\n${productDescriptionBlock}`,
    `\nSCRAPED DATA:\n${scraped_text || "(not available)"}`,
    `\nCOMPETITOR URLS:\n${competitorUrlsBlock}`,
    `\nCOMPETITOR DATA:\n${competitorDataBlock}`,
  ].join("");

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: RESEARCH_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const output = message.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ success: true, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
