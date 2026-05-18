import Anthropic from "@anthropic-ai/sdk";
import { IDENTIFY_PROMPT } from "@/lib/prompts/research/identify";
import { MARKET_PROMPT } from "@/lib/prompts/research/market";
import { COMPETITIVE_PROMPT } from "@/lib/prompts/research/competitive";
import { PRODUCT_ANALYSIS_PROMPT } from "@/lib/prompts/research/product_analysis";
import { VISUAL_PROMPT } from "@/lib/prompts/research/visual";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ResearchInputs {
  product_url: string;
  product_description?: string;
  scraped_text?: string;
  competitor_urls?: string[];
  competitor_scraped?: { url: string; text: string }[];
}

function buildBaseContext(inputs: ResearchInputs): string {
  return [
    `PRODUCT URL: ${inputs.product_url}`,
    inputs.product_description?.trim()
      ? `\nUSER DESCRIPTION (clarifying context — use alongside scraped data):\n${inputs.product_description.trim()}`
      : "\nUSER DESCRIPTION: Not provided",
    `\nSCRAPED DATA (listing content, pricing, images):\n${inputs.scraped_text || "(not available)"}`,
  ].join("");
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
    messages: [{ role: "user", content: buildBaseContext(inputs) }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}

// ── Call 2: Market Overview + Pain Points + Desires ──────────────────────────

export async function runMarket(inputs: ResearchInputs, identifyOutput: string): Promise<string> {
  const userMessage = [
    buildBaseContext(inputs),
    `\n\n--- PRODUCT IDENTIFICATION (from previous analysis) ---\n${identifyOutput}`,
  ].join("");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3000,
    system: MARKET_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
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

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3000,
    system: COMPETITIVE_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
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
    `PRODUCT URL: ${inputs.product_url}`,
    `\n\n--- PRODUCT IDENTIFICATION ---\n${identifyOutput}`,
    `\n\n--- CUSTOMER DESIRES ---\n${avatarSection || marketOutput.slice(0, 1000)}`,
    `\n\n--- COMPETITIVE LANDSCAPE ---\n${competitiveOutput}`,
    buildCompetitorContext(inputs),
  ].join("");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: VISUAL_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}
