import Anthropic from "@anthropic-ai/sdk";
import { IDENTIFY_PROMPT } from "@/lib/prompts/research/identify";
import { MARKET_PROMPT } from "@/lib/prompts/research/market";
import { COMPETITIVE_PROMPT } from "@/lib/prompts/research/competitive";
import { PRODUCT_ANALYSIS_PROMPT } from "@/lib/prompts/research/product_analysis";
import { VISUAL_PROMPT } from "@/lib/prompts/research/visual";

// timeout: a hung research call fails within 2 min instead of the SDK's
// 10-min default, so a stalled Stage 1 step can't freeze the pipeline.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });

// Server-side web search tool. Anthropic runs the searches itself and feeds
// the results back to the model within a single create() call, so the final
// message already contains text + citations — no manual agentic loop needed.
// Localised to Germany so results are German-market relevant. Disable per-run
// by setting RESEARCH_WEB_SEARCH=off.
const WEB_SEARCH_ENABLED = (process.env.RESEARCH_WEB_SEARCH ?? "on").toLowerCase() !== "off";
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305" as const,
  name: "web_search" as const,
  max_uses: 5,
  user_location: { type: "approximate" as const, country: "DE" },
};

// Appended to the market + competitive system prompts when search is on, so
// the model actually uses the tool instead of falling back on training memory.
const SEARCH_DIRECTIVE = `

--- LIVE WEB SEARCH AVAILABLE ---
You have a web_search tool. Use it to ground this analysis in current reality, not memory:
- Search the GERMAN web (Amazon.de reviews, Idealo, German forums/Reddit, Stiftung Warentest, retailer pages) for this product category.
- Verify market figures, price ranges, and named competitors against real listings — do not invent numbers.
- Pull real customer pain-point language from actual reviews; quote it where useful.
- If a search returns nothing solid for a claim, say so or drop the claim rather than fabricating.
Prefer 2–4 targeted searches over many shallow ones. Write the final analysis in the required structure; do not include raw search dumps.`;

function withSearchDirective(system: string): string {
  return WEB_SEARCH_ENABLED ? system + SEARCH_DIRECTIVE : system;
}

// With tools enabled the response interleaves text blocks with tool_use /
// web_search_tool_result blocks. Concatenate every text block so we don't
// drop the model's prose that lands after a search result.
function collectText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export interface ResearchInputs {
  /** May be null in the description-first flow (user provided description + images instead). */
  product_url: string | null;
  product_description?: string;
  scraped_text?: string;
  competitor_urls?: string[];
  competitor_scraped?: { url: string; text: string }[];
  /** R2 URLs uploaded by the user — used as vision context for identify+visual. */
  source_image_urls?: string[];
}

const DATA_PRIORITY_BLOCK = `\nDATA SOURCE PRIORITY:
You will receive multiple data sources about this product. Use them in this priority order:

1. USER DESCRIPTION — Source of truth. If anything conflicts, the user description wins.
2. SOURCE IMAGES — Visual reference for what the product looks like. Use these for visual decisions and to fill in details the description doesn't mention.
3. SCRAPED PRODUCT DATA (optional) — Supplementary context from the supplier listing. May or may not exist. Use only for technical specs/dimensions the description doesn't cover. NEVER override the user description with scraped data.
4. COMPETITOR DATA (optional) — Only for competitive landscape, never for product details.
`;

function buildBaseContext(inputs: ResearchInputs): string {
  const desc = inputs.product_description?.trim();
  return [
    DATA_PRIORITY_BLOCK,
    desc
      ? `\nUSER DESCRIPTION (source of truth):\n${desc}`
      : "\nUSER DESCRIPTION: (not provided)",
    inputs.product_url
      ? `\nPRODUCT URL: ${inputs.product_url}`
      : "\nPRODUCT URL: (not provided — description-first run)",
    inputs.scraped_text
      ? `\nSCRAPED PRODUCT DATA (supplementary):\n${inputs.scraped_text}`
      : "\nSCRAPED PRODUCT DATA: (none — rely on description and source images)",
    inputs.source_image_urls?.length
      ? `\nSOURCE IMAGES: ${inputs.source_image_urls.length} provided (attached as images in the message)`
      : "\nSOURCE IMAGES: (none provided)",
  ].join("");
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

function buildMessageContent(text: string, imageUrls?: string[]): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text }];
  // Cap at 5 images to keep token / latency bounded
  for (const url of (imageUrls ?? []).slice(0, 5)) {
    blocks.push({ type: "image", source: { type: "url", url } });
  }
  return blocks;
}

function buildCompetitorContext(inputs: ResearchInputs): string {
  const urls = inputs.competitor_urls?.length
    ? inputs.competitor_urls.join("\n")
    : "None provided";
  const data = inputs.competitor_scraped?.length
    ? inputs.competitor_scraped
        .map((c) => `Competitor: ${c.url}\nContent: ${c.text.slice(0, 1500)}\n`)
        .join("\n")
    : "(not available)";
  return `\nCOMPETITOR URLS:\n${urls}\n\nCOMPETITOR DATA:\n${data}`;
}

// ── Call 1: Product Identification ───────────────────────────────────────────

export async function runIdentify(inputs: ResearchInputs): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1500,
    system: IDENTIFY_PROMPT,
    messages: [
      { role: "user", content: buildMessageContent(buildBaseContext(inputs), inputs.source_image_urls) },
    ],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}

// ── Call 2: Market Overview + Pain Points + Desires ──────────────────────────

export async function runMarket(inputs: ResearchInputs, identifyOutput: string): Promise<string> {
  const userMessage = [
    buildBaseContext(inputs),
    `\n\n--- PRODUCT IDENTIFICATION (from previous analysis) ---\n${identifyOutput}`,
  ].join("");

  const msg = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: withSearchDirective(MARKET_PROMPT),
      messages: [{ role: "user", content: userMessage }],
      ...(WEB_SEARCH_ENABLED ? { tools: [WEB_SEARCH_TOOL] } : {}),
    },
    // Web search adds round trips; give it more headroom than a plain call.
    WEB_SEARCH_ENABLED ? { timeout: 180_000 } : undefined,
  );
  return collectText(msg.content);
}

// ── Call 3: Competitive Landscape ────────────────────────────────────────────

export async function runCompetitive(
  inputs: ResearchInputs,
  identifyOutput: string,
  marketOutput: string
): Promise<string> {
  const userMessage = [
    buildBaseContext(inputs),
    buildCompetitorContext(inputs),
    `\n\n--- PRODUCT IDENTIFICATION ---\n${identifyOutput}`,
    `\n\n--- MARKET OVERVIEW SUMMARY ---\n${marketOutput.slice(0, 1500)}`,
  ].join("");

  const msg = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: withSearchDirective(COMPETITIVE_PROMPT),
      messages: [{ role: "user", content: userMessage }],
      ...(WEB_SEARCH_ENABLED ? { tools: [WEB_SEARCH_TOOL] } : {}),
    },
    WEB_SEARCH_ENABLED ? { timeout: 180_000 } : undefined,
  );
  return collectText(msg.content);
}

// ── Call 4: Product Analysis + Market Sophistication + Levels ────────────────

export async function runProductAnalysis(
  inputs: ResearchInputs,
  identifyOutput: string,
  marketOutput: string,
  competitiveOutput: string
): Promise<string> {
  const painPointsSection = marketOutput.includes("3. CUSTOMER PAIN POINTS")
    ? marketOutput.slice(marketOutput.indexOf("3. CUSTOMER PAIN POINTS"))
    : marketOutput.slice(0, 2000);

  const userMessage = [
    buildBaseContext(inputs),
    `\n\n--- PRODUCT IDENTIFICATION ---\n${identifyOutput}`,
    `\n\n--- CUSTOMER PAIN POINTS & DESIRES ---\n${painPointsSection}`,
    `\n\n--- COMPETITIVE LANDSCAPE SUMMARY ---\n${competitiveOutput.slice(0, 1500)}`,
  ].join("");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: PRODUCT_ANALYSIS_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}

// ── Call 5: Visual Strategy ──────────────────────────────────────────────────

export async function runVisual(
  inputs: ResearchInputs,
  identifyOutput: string,
  marketOutput: string,
  competitiveOutput: string
): Promise<string> {
  const avatarSection = marketOutput.includes("4. CUSTOMER DESIRES")
    ? marketOutput.slice(marketOutput.indexOf("4. CUSTOMER DESIRES"))
    : "";

  const userMessage = [
    inputs.product_url ? `PRODUCT URL: ${inputs.product_url}` : "PRODUCT URL: (not provided)",
    `\n\n--- PRODUCT IDENTIFICATION ---\n${identifyOutput}`,
    `\n\n--- CUSTOMER DESIRES ---\n${avatarSection || marketOutput.slice(0, 1000)}`,
    `\n\n--- COMPETITIVE LANDSCAPE ---\n${competitiveOutput}`,
    buildCompetitorContext(inputs),
    inputs.source_image_urls?.length
      ? `\n\n--- SOURCE IMAGES ---\n${inputs.source_image_urls.length} user-uploaded reference images attached (visual ground truth for the product).`
      : "",
  ].join("");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: VISUAL_PROMPT,
    messages: [
      { role: "user", content: buildMessageContent(userMessage, inputs.source_image_urls) },
    ],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}
