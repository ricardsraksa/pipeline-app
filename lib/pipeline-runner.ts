import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, db } from "./db";
import type { Run } from "./db";
import {
  runIdentify,
  runMarket,
  runCompetitive,
  runProductAnalysis,
  runVisual,
  type ResearchInputs,
} from "./research/runner";
import { CHIEF_MID_PROMPT } from "./prompts/chief_mid";
import { REVISE_RESEARCH_PROMPT } from "./prompts/revise_research";
import { AVATAR_PROMPT } from "./prompts/avatar";
import { OFFER_BRIEF_PROMPT } from "./prompts/offer_brief";
import { NECESSARY_BELIEFS_PROMPT } from "./prompts/necessary_beliefs";
import { CHIEF_FINAL_PROMPT } from "./prompts/chief_final";
import { REVISE_DOC_PROMPT } from "./prompts/revise_doc";
import { getPrompt } from "./prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// In-memory lock to prevent a runId from being executed concurrently in the
// same process (covers the common case of double-resume clicks). On a multi-
// instance deploy this is not bulletproof, but combined with the DB status
// check below it's good enough.
const RUNNING_PIPELINES = new Set<number>();

function now(): string {
  return new Date().toISOString();
}

function getBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  );
}

function safeJson<T = unknown>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// Retry wrapper for transient API failures (network errors, 429s, 5xxs).
// Anthropic SDK already retries internally, but we add an extra layer with
// jittered backoff in case the SDK gives up too early on a long pipeline.
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { label: string; maxRetries?: number } = { label: "anthropic call" },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      // Don't retry obvious user errors
      if (/401|403|invalid api key|authentication/i.test(message)) throw err;
      if (attempt === maxRetries) break;
      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[${opts.label}] attempt ${attempt + 1} failed: ${message}. Retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function anthropicMessage(args: {
  system: string;
  user: string;
  maxTokens: number;
  label: string;
}): Promise<string> {
  const msg = await withRetry(
    () =>
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
      }),
    { label: args.label },
  );
  return msg.content.find((b) => b.type === "text")?.text ?? "";
}

// ── Slug helpers (mirrored from page.tsx) ────────────────────────────────────

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function extractProductName(researchText: string): string | null {
  const match = researchText.match(/(?:1\.|product identification)[^\n]*\n([\s\S]{0,400}?)(?:\n\n\d\.|\n\n##)/i);
  if (!match) return null;
  const firstLine = match[1]
    .split("\n")
    .map((l) => l.replace(/^[-*\s]+/, "").trim())
    .find((l) => l.length > 3 && l.length < 80);
  return firstLine ? toSlug(firstLine) || null : null;
}

function extractBrandName(offerBriefText: string): string | null {
  const isListLine = (l: string) => /^(?:[-*]|\d+[.):])\s+\S/.test(l);
  function parseLine(line: string): string | null {
    const stripped = line.replace(/^(?:[-*]|\d+[.):])\s+/, "").replace(/\*\*/g, "").trim();
    const name = stripped.split(/\s+[-–—]\s+|\s+\(/)[0].trim();
    return name.length > 0 && name.length < 60 ? name : null;
  }
  const optionsMatch = offerBriefText.match(
    /brand name[^\n]*?(?:options?|suggestions?)[^\n]*\n([\s\S]{0,600}?)(?=\n\n\d\.|\n\n\*\*\d\.|\n\n##|$)/i
  );
  if (optionsMatch) {
    const listLine = optionsMatch[1].split("\n").find(isListLine);
    if (listLine) { const n = parseLine(listLine); if (n) return toSlug(n) || null; }
  }
  const sectionMatch = offerBriefText.match(/(?:product name|brand name)[^\n]*\n([\s\S]{0,600}?)(?:\n\n|\n##)/i);
  if (sectionMatch) {
    const listLine = sectionMatch[1].split("\n").find(isListLine);
    if (listLine) { const n = parseLine(listLine); if (n) return toSlug(n) || null; }
  }
  return null;
}

// ── Stage 2 feedback helper ──────────────────────────────────────────────────

async function buildStage2FeedbackBlock(): Promise<string> {
  try {
    const result = await db.execute(
      `SELECT stage2_output FROM runs WHERE feedback_stage2 = 'up' AND stage2_output IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    const rows = result.rows as unknown as Pick<Run, "stage2_output">[];
    if (!rows.length) return "";
    const summaries = rows.map((r) => (r.stage2_output as string).slice(0, 300));
    return "\n\n--- PREVIOUS OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return "";
  }
}

// ── Step 6: revision helpers (from pipeline/step6/route.ts) ─────────────────

interface DocRevision { docName: string; changes: string; }

function parseRevisions(chiefFinal: string): DocRevision[] {
  const revisions: DocRevision[] = [];
  const revisionsMatch = chiefFinal.match(/Revisions Required[\s\S]*/i);
  if (!revisionsMatch) return revisions;
  const docPattern = /DOCUMENT:\s*(\S+\.txt)\s*\nCHANGES:\s*([\s\S]*?)(?=\nDOCUMENT:|\n?$)/gi;
  let match;
  while ((match = docPattern.exec(revisionsMatch[0])) !== null) {
    const changes = match[2].trim();
    if (changes) revisions.push({ docName: match[1].trim(), changes });
  }
  return revisions;
}

async function reviseDoc(original: string, docType: string, changes: string): Promise<string> {
  const text = await anthropicMessage({
    system: REVISE_DOC_PROMPT,
    user: `Document type: ${docType}\n\nOriginal document:\n\n${original}\n\n---\n\nRequired changes:\n\n${changes}`,
    maxTokens: 4000,
    label: `revise ${docType}`,
  });
  return text || original;
}

// ── Last completed stage detector ────────────────────────────────────────────

export type LastStage = "none" | "scrape" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

export function getLastCompletedStage(run: Run): LastStage {
  if (run.generated_images) return "stage3-images";
  if (run.image_prompts) return "stage3-prompts";
  if (run.stage2_output) return "stage2";
  if (run.step_necessary_beliefs || run.step_chief_final) return "stage1";
  if (run.scraper_data) return "scrape";
  return "none";
}

// ── Core stage runners ────────────────────────────────────────────────────────

async function runScrape(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "scraping", current_step: "Scraping product page", last_updated_at: now() });

  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: run.product_url }),
  });
  const scrapeData = await res.json();
  if (!scrapeData.success) throw new Error(scrapeData.error ?? "Scrape failed");

  const d = scrapeData.data ?? scrapeData;
  const competitorUrls: string[] = safeJson<string[]>(run.competitor_urls, []);

  let competitorScraped: { url: string; text: string }[] = [];
  if (competitorUrls.length > 0) {
    const results = await Promise.allSettled(
      competitorUrls.map((u) =>
        fetch(`${baseUrl}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
        }).then((r) => r.json())
      )
    );
    competitorScraped = results
      .map((r, i) => {
        if (r.status !== "fulfilled" || !r.value.success) return null;
        const cd = r.value.data ?? r.value;
        return cd.scraped_text ? { url: competitorUrls[i], text: cd.scraped_text } : null;
      })
      .filter(Boolean) as { url: string; text: string }[];
  }

  await updateRun(runId, {
    scraper_data: JSON.stringify({ scraped_text: d.scraped_text ?? "", images: d.images ?? [] }),
    scraped_image_urls: JSON.stringify(d.images ?? []),
    last_updated_at: now(),
  });

  // Store competitor scraped data temporarily in scraper_data
  if (competitorScraped.length > 0) {
    const existing = safeJson<Record<string, unknown>>((await getRun(runId))?.scraper_data ?? null, {});
    await updateRun(runId, {
      scraper_data: JSON.stringify({ ...existing, competitor_scraped: competitorScraped }),
      last_updated_at: now(),
    });
  }
}

async function runStage1(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage1", current_step: "Stage 1: Identifying product (1/5)", last_updated_at: now() });

  const scraperData = safeJson<{
    scraped_text?: string;
    competitor_scraped?: Array<{ url: string; text: string }>;
  }>(run.scraper_data, {});

  const inputs: ResearchInputs = {
    product_url: run.product_url,
    product_description: run.product_description ?? undefined,
    scraped_text: scraperData.scraped_text ?? "",
    competitor_urls: safeJson<string[]>(run.competitor_urls, []),
    competitor_scraped: scraperData.competitor_scraped ?? [],
  };

  await updateRun(runId, { current_step: "Stage 1: Identifying product (1/5)", last_updated_at: now() });
  const identify = await runIdentify(inputs);

  await updateRun(runId, { current_step: "Stage 1: Market overview (2/5)", last_updated_at: now() });
  const market = await runMarket(inputs, identify);

  await updateRun(runId, { current_step: "Stage 1: Competitive landscape (3/5)", last_updated_at: now() });
  const competitive = await runCompetitive(inputs, identify, market);

  await updateRun(runId, { current_step: "Stage 1: Product analysis (4/5)", last_updated_at: now() });
  const productAnalysis = await runProductAnalysis(inputs, identify, market, competitive);

  await updateRun(runId, { current_step: "Stage 1: Visual strategy (5/5)", last_updated_at: now() });
  const visual = await runVisual(inputs, identify, market, competitive);

  const research = [identify, market, competitive, productAnalysis, visual].filter(Boolean).join("\n\n");
  if (!research) throw new Error("Stage 1 produced no output");

  const productName = extractProductName(research);
  await updateRun(runId, {
    step_research: research,
    product_name: productName ?? run.product_url,
    current_step: "Stage 1: Mid chief review (6/8)",
    last_updated_at: now(),
  });

  // Step 2: Chief mid review
  const chiefMid = await anthropicMessage({
    system: CHIEF_MID_PROMPT,
    user: `RESEARCH.txt to review:\n\n${research}`,
    maxTokens: 4000,
    label: "chief mid review",
  });
  await updateRun(runId, { step_chief_mid: chiefMid, current_step: "Stage 1: Revising research (7/8)", last_updated_at: now() });

  // Step 3: Research revised
  let researchRevised = research;
  if (chiefMid && !chiefMid.includes("NO REVISIONS REQUIRED")) {
    const revised = await anthropicMessage({
      system: REVISE_RESEARCH_PROMPT,
      user: `RESEARCH.txt (original):\n\n${research}\n\n---\n\nCHIEF_MID.txt (review):\n\n${chiefMid}`,
      maxTokens: 8000,
      label: "revise research",
    });
    if (revised) researchRevised = revised;
  }
  await updateRun(runId, { step_research_revised: researchRevised, current_step: "Stage 1: Building avatar (8/8)", last_updated_at: now() });

  // Step 4a: Avatar
  const avatar = await anthropicMessage({
    system: AVATAR_PROMPT,
    user: `RESEARCH.txt:\n\n${researchRevised}`,
    maxTokens: 3500,
    label: "avatar",
  });
  if (!avatar) throw new Error("Stage 1: avatar generation returned empty");
  await updateRun(runId, { step_avatar: avatar, current_step: "Stage 1: Writing offer brief", last_updated_at: now() });

  // Step 4b: Offer brief
  const offerBrief = await anthropicMessage({
    system: OFFER_BRIEF_PROMPT,
    user: `RESEARCH.txt:\n\n${researchRevised}\n\n---\n\nAVATAR.txt:\n\n${avatar}`,
    maxTokens: 3500,
    label: "offer brief",
  });
  if (!offerBrief) throw new Error("Stage 1: offer brief returned empty");
  const brandName = extractBrandName(offerBrief);
  await updateRun(runId, {
    step_offer_brief: offerBrief,
    brand_name: brandName,
    current_step: "Stage 1: Identifying necessary beliefs",
    last_updated_at: now(),
  });

  // Step 4c: Necessary beliefs
  const necessaryBeliefs = await anthropicMessage({
    system: NECESSARY_BELIEFS_PROMPT,
    user: `RESEARCH.txt:\n\n${researchRevised}\n\n---\n\nAVATAR.txt:\n\n${avatar}\n\n---\n\nOFFER_BRIEF.txt:\n\n${offerBrief}`,
    maxTokens: 3500,
    label: "necessary beliefs",
  });
  if (!necessaryBeliefs) throw new Error("Stage 1: necessary beliefs returned empty");
  await updateRun(runId, { step_necessary_beliefs: necessaryBeliefs, current_step: "Stage 1: Final chief review", last_updated_at: now() });

  // Step 5: Chief final
  const chiefFinal = await anthropicMessage({
    system: CHIEF_FINAL_PROMPT,
    user: [
      `RESEARCH.txt (revised):\n\n${researchRevised}`,
      `\n\n---\n\nAVATAR.txt:\n\n${avatar}`,
      `\n\n---\n\nOFFER_BRIEF.txt:\n\n${offerBrief}`,
      `\n\n---\n\nNECESSARY_BELIEFS.txt:\n\n${necessaryBeliefs}`,
    ].join(""),
    maxTokens: 4000,
    label: "chief final review",
  });
  await updateRun(runId, { step_chief_final: chiefFinal, current_step: "Stage 1: Applying final revisions", last_updated_at: now() });

  // Step 6: Revisions
  let avatarRevised = avatar;
  let offerBriefRevised = offerBrief;
  let necessaryBeliefsRevised = necessaryBeliefs;
  if (!chiefFinal.includes("NO REVISIONS REQUIRED")) {
    const revisions = parseRevisions(chiefFinal);
    for (const rev of revisions) {
      if (rev.docName === "AVATAR.txt") avatarRevised = await reviseDoc(avatar, "AVATAR.txt", rev.changes);
      else if (rev.docName === "OFFER_BRIEF.txt") offerBriefRevised = await reviseDoc(offerBrief, "OFFER_BRIEF.txt", rev.changes);
      else if (rev.docName === "NECESSARY_BELIEFS.txt") necessaryBeliefsRevised = await reviseDoc(necessaryBeliefs, "NECESSARY_BELIEFS.txt", rev.changes);
    }
  }
  await updateRun(runId, {
    step_avatar_revised: avatarRevised,
    step_offer_brief_revised: offerBriefRevised,
    step_necessary_beliefs_revised: necessaryBeliefsRevised,
    last_updated_at: now(),
  });
}

async function runStage2(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage2", current_step: "Stage 2: Generating German copy", last_updated_at: now() });

  const stage1Output = run.step_research_revised ?? run.step_research ?? "";
  if (!stage1Output) throw new Error("No Stage 1 output to run Stage 2");

  const systemPrompt = getPrompt("stage2") + await buildStage2FeedbackBlock();
  const productName = run.brand_name ?? run.product_name ?? "";

  const output = await anthropicMessage({
    system: systemPrompt,
    user: `PRODUCT NAME: ${productName || "(not provided — choose the best name from the research)"}\n\nRESEARCH BRIEF (Stage 1 output):\n${stage1Output}\n\nProduce the complete German copy kit now.`,
    maxTokens: 8192,
    label: "stage 2 German copy",
  });
  if (!output) throw new Error("Stage 2 produced no output");

  await updateRun(runId, { stage2_output: output, last_updated_at: now() });
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

const ACTIVE_DB_STATUSES = new Set(["scraping", "stage1", "stage2"]);

export async function runPipeline(runId: number): Promise<void> {
  if (RUNNING_PIPELINES.has(runId)) {
    console.warn(`Pipeline ${runId} is already executing in this process — skipping duplicate run.`);
    return;
  }
  RUNNING_PIPELINES.add(runId);
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");

    // If another instance/process recently picked it up, don't double-execute.
    // We only block if it's actively running AND the last update was very recent
    // (otherwise we'd never recover from a crashed instance).
    if (ACTIVE_DB_STATUSES.has(run.status ?? "")) {
      const ageMs = run.last_updated_at
        ? Date.now() - new Date(run.last_updated_at).getTime()
        : Infinity;
      if (ageMs < 60_000) {
        console.warn(`Pipeline ${runId} is already running (status=${run.status}, updated ${Math.round(ageMs / 1000)}s ago) — skipping.`);
        return;
      }
    }

    await runScrape(runId, run);

    const runAfterScrape = await getRun(runId);
    if (!runAfterScrape) throw new Error("Run not found after scrape");
    await runStage1(runId, runAfterScrape);

    const runAfterStage1 = await getRun(runId);
    if (!runAfterStage1) throw new Error("Run not found after stage 1");
    await runStage2(runId, runAfterStage1);

    await updateRun(runId, {
      status: "awaiting_user",
      current_step: "Awaiting image approval for Stage 3",
      last_updated_at: now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Pipeline ${runId} failed:`, message);
    await updateRun(runId, {
      status: "failed",
      error_message: message,
      last_updated_at: now(),
    }).catch(() => {});
  } finally {
    RUNNING_PIPELINES.delete(runId);
  }
}

// ── Resume pipeline from last completed stage ─────────────────────────────────

export async function resumePipeline(runId: number): Promise<void> {
  if (RUNNING_PIPELINES.has(runId)) {
    console.warn(`Resume ${runId} skipped — pipeline already running.`);
    return;
  }
  RUNNING_PIPELINES.add(runId);
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");

    // Clear error state
    await updateRun(runId, { error_message: null, last_updated_at: now() });

    const lastStage = getLastCompletedStage(run);

    if (lastStage === "none") {
      await runPipeline(runId);
      return;
    }

    if (lastStage === "scrape") {
      const freshRun = await getRun(runId);
      if (!freshRun) throw new Error("Run not found");
      await runStage1(runId, freshRun);
      const afterStage1 = await getRun(runId);
      if (!afterStage1) throw new Error("Run not found after stage 1");
      await runStage2(runId, afterStage1);
      await updateRun(runId, {
        status: "awaiting_user",
        current_step: "Awaiting image approval for Stage 3",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage1") {
      // Check if stage1 is actually complete (all docs present) or partial
      if (!run.step_research_revised || !run.step_avatar || !run.step_offer_brief ||
          !run.step_necessary_beliefs || !run.step_chief_final ||
          !run.step_avatar_revised) {
        // Stage 1 was partially done — re-run it
        const freshRun = await getRun(runId);
        if (!freshRun) throw new Error("Run not found");
        await runStage1(runId, freshRun);
      }
      const afterStage1 = await getRun(runId);
      if (!afterStage1) throw new Error("Run not found");
      await runStage2(runId, afterStage1);
      await updateRun(runId, {
        status: "awaiting_user",
        current_step: "Awaiting image approval for Stage 3",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage2") {
      await updateRun(runId, {
        status: "awaiting_user",
        current_step: "Awaiting image approval for Stage 3",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage3-prompts") {
      await updateRun(runId, {
        status: "awaiting_qc",
        current_step: "Awaiting prompt review for Stage 3",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage3-images") {
      await updateRun(runId, {
        status: "completed",
        current_step: "Complete",
        completed_at: now(),
        last_updated_at: now(),
      });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Resume ${runId} failed:`, message);
    await updateRun(runId, {
      status: "failed",
      error_message: message,
      last_updated_at: now(),
    }).catch(() => {});
  } finally {
    RUNNING_PIPELINES.delete(runId);
  }
}
