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
import { AVATAR_PROMPT } from "./prompts/avatar";
import { OFFER_BRIEF_PROMPT } from "./prompts/offer_brief";
import { NECESSARY_BELIEFS_PROMPT } from "./prompts/necessary_beliefs";
import { CHIEF_FINAL_PROMPT } from "./prompts/chief_final";
import { REVISE_DOC_PROMPT } from "./prompts/revise_doc";
import { getPrompt } from "./prompts";
import {
  buildStage1FeedbackBlock,
  buildStage2FeedbackBlock as buildStage2NotesBlock,
} from "./feedback";

// timeout: a hung Anthropic request fails within 2 min instead of the SDK's
// 10-min default, so a stalled Stage 1 call surfaces as a resumable failure
// rather than an indefinitely "stuck" run.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
// Faster, cheaper model for mechanical steps (doc revision, summarization)
// that don't need Sonnet-level reasoning.
const CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001";
// Hard cap on each scrape HTTP call — a slow/unresponsive supplier site must
// not hang the whole pipeline. Unbounded scrape fetches were the primary cause
// of runs stuck at Stage 1.
const SCRAPE_TIMEOUT_MS = 45_000;

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
  model?: string;
}): Promise<string> {
  const msg = await withRetry(
    () =>
      anthropic.messages.create({
        model: args.model ?? CLAUDE_MODEL,
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
// Combines two signals:
//   1. The thumbs-up + free-text note loop from lib/feedback.ts.
//   2. The full text of past thumbs-up Stage 2 outputs (good-tone examples).
async function buildStage2FeedbackBlock(): Promise<string> {
  const noteBlock = await buildStage2NotesBlock();
  try {
    const result = await db.execute(
      `SELECT stage2_output FROM runs WHERE feedback_stage2 = 'up' AND stage2_output IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    const rows = result.rows as unknown as Pick<Run, "stage2_output">[];
    if (!rows.length) return noteBlock;
    const summaries = rows.map((r) => (r.stage2_output as string).slice(0, 300));
    return noteBlock + "\n\n--- PREVIOUS STAGE-2 OUTPUTS THAT WORKED WELL ---\n" + summaries.join("\n\n") + "\n---";
  } catch {
    return noteBlock;
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
    // Mechanical doc editing against an explicit changelist — Haiku is enough.
    model: CLAUDE_HAIKU_MODEL,
  });
  return text || original;
}

// ── Last completed stage detector ────────────────────────────────────────────

export type LastStage = "none" | "scrape" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

export function getLastCompletedStage(run: Run): LastStage {
  if (run.generated_images) return "stage3-images";
  if (run.image_prompts) return "stage3-prompts";
  if (run.stage2_output) return "stage2";
  // Stage 1 is only "complete" once the one-pager exists (it's the final sub-step now)
  if (run.stage1_one_pager) return "stage1";
  if (run.scraper_data) return "scrape";
  return "none";
}

// ── Core stage runners ────────────────────────────────────────────────────────

async function runScrape(runId: number, run: Run): Promise<void> {
  const hasProductUrl = Boolean(run.product_url && run.product_url.trim());
  const competitorUrls: string[] = safeJson<string[]>(run.competitor_urls, []);
  const hasCompetitorUrls = competitorUrls.length > 0;

  // If no URLs at all, skip the whole scrape step — the new description-first
  // flow may legitimately have nothing to scrape.
  if (!hasProductUrl && !hasCompetitorUrls) {
    return;
  }

  // Scraping runs silently — no status/current_step updates so the UI never shows a scraping state.

  const baseUrl = getBaseUrl();

  // Scrape the product URL when provided. Failures are non-fatal in the new
  // flow because the user description is the source of truth.
  let productScrapedText = "";
  let productImages: string[] = [];
  if (hasProductUrl) {
    try {
      const res = await fetch(`${baseUrl}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: run.product_url }),
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      });
      const scrapeData = await res.json();
      if (scrapeData.success) {
        const d = scrapeData.data ?? scrapeData;
        productScrapedText = d.scraped_text ?? "";
        productImages = Array.isArray(d.images) ? d.images : [];
      } else {
        console.warn(`Product scrape failed for run ${runId}:`, scrapeData.error);
        const existingNotes = safeJson<Record<string, unknown>>((await getRun(runId))?.notes ?? null, {});
        await updateRun(runId, {
          notes: JSON.stringify({
            ...existingNotes,
            productScrapeError: scrapeData.error ?? "Scraper returned failure",
          }),
          last_updated_at: now(),
        });
      }
    } catch (err) {
      console.warn(`Product scrape exception for run ${runId}:`, err);
      const existingNotes = safeJson<Record<string, unknown>>((await getRun(runId))?.notes ?? null, {});
      await updateRun(runId, {
        notes: JSON.stringify({
          ...existingNotes,
          productScrapeError: err instanceof Error ? err.message : "Network error",
        }),
        last_updated_at: now(),
      });
    }
  }

  let competitorScraped: { url: string; text: string }[] = [];
  const competitorErrors: { url: string; error: string }[] = [];
  if (competitorUrls.length > 0) {
    const results = await Promise.allSettled(
      competitorUrls.map((u) =>
        fetch(`${baseUrl}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
          signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
        }).then((r) => r.json())
      )
    );
    results.forEach((r, i) => {
      const url = competitorUrls[i];
      if (r.status !== "fulfilled") {
        competitorErrors.push({ url, error: r.reason?.message ?? "Network error" });
        return;
      }
      if (!r.value.success) {
        competitorErrors.push({ url, error: r.value.error ?? "Scraper returned failure" });
        return;
      }
      const cd = r.value.data ?? r.value;
      if (cd.scraped_text) {
        competitorScraped.push({ url, text: cd.scraped_text });
      } else {
        competitorErrors.push({ url, error: "No text scraped from page" });
      }
    });
  }

  await updateRun(runId, {
    scraper_data: JSON.stringify({ scraped_text: productScrapedText, images: productImages }),
    scraped_image_urls: JSON.stringify(productImages),
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

  // Surface competitor scrape errors in run notes so the UI can show them
  if (competitorErrors.length > 0) {
    const existingNotes = safeJson<Record<string, unknown>>((await getRun(runId))?.notes ?? null, {});
    await updateRun(runId, {
      notes: JSON.stringify({ ...existingNotes, scrapeErrors: competitorErrors }),
      last_updated_at: now(),
    });
  }
}

async function runStage1(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage1", last_updated_at: now() });

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
    source_image_urls: safeJson<string[]>(run.uploaded_source_images, []),
  };

  // ── Sub-step 1-5: Research modules (skip if already in DB) ──
  let research = run.step_research ?? "";
  if (!research) {
    await updateRun(runId, { current_step: "Stage 1: Identifying product (1/5)", last_updated_at: now() });
    const identify = await runIdentify(inputs);

    await updateRun(runId, { current_step: "Stage 1: Market overview (2/5)", last_updated_at: now() });
    const market = await runMarket(inputs, identify);

    await updateRun(runId, { current_step: "Stage 1: Competitive landscape (3/5)", last_updated_at: now() });
    const competitive = await runCompetitive(inputs, identify, market);

    // Product analysis and visual strategy both depend only on identify +
    // market + competitive — neither consumes the other — so run them together.
    await updateRun(runId, { current_step: "Stage 1: Product analysis + visual strategy (4/5)", last_updated_at: now() });
    const [productAnalysis, visual] = await Promise.all([
      runProductAnalysis(inputs, identify, market, competitive),
      runVisual(inputs, identify, market, competitive),
    ]);

    research = [identify, market, competitive, productAnalysis, visual].filter(Boolean).join("\n\n");
    if (!research) throw new Error("Stage 1 produced no output");

    const productName = extractProductName(research);
    // Only persist a name we actually extracted. Don't fall back to product_url
    // (it can be null in the description-first flow, and a raw URL is a bad
    // display name even when present).
    await updateRun(runId, {
      step_research: research,
      ...(productName ? { product_name: productName } : {}),
      last_updated_at: now(),
    });
  }

  // ── Research is used downstream as-is ──
  // The mid-review pass (chief mid review + research revision) was removed for
  // speed — it was ~30% of Stage 1 wall-clock. step_chief_mid stays null;
  // step_research_revised mirrors step_research so the resume check and every
  // downstream reader (which read step_research_revised) keep working. Runs
  // created before this change keep their genuinely-revised text.
  let researchRevised = run.step_research_revised ?? "";
  if (!researchRevised) {
    researchRevised = research;
    await updateRun(runId, { step_research_revised: researchRevised, last_updated_at: now() });
  }

  // ── Sub-step 4a-c: Avatar, offer brief & necessary beliefs (parallel) ──
  // Each of these now works from RESEARCH.txt alone, so the three run
  // concurrently instead of chaining avatar → offer brief → beliefs. Any
  // doc already in the DB is skipped (granular resume); whatever succeeds is
  // persisted even if a sibling fails, so a resume only redoes the failures.
  let avatar = run.step_avatar ?? "";
  let offerBrief = run.step_offer_brief ?? "";
  let necessaryBeliefs = run.step_necessary_beliefs ?? "";

  const needAvatar = !avatar;
  const needOfferBrief = !offerBrief;
  const needBeliefs = !necessaryBeliefs;

  if (needAvatar || needOfferBrief || needBeliefs) {
    await updateRun(runId, {
      current_step: "Stage 1: Avatar, offer brief & necessary beliefs (parallel)",
      last_updated_at: now(),
    });

    const tasks: { key: "avatar" | "offerBrief" | "beliefs"; run: () => Promise<string> }[] = [];
    if (needAvatar) {
      tasks.push({
        key: "avatar",
        run: () =>
          anthropicMessage({
            system: AVATAR_PROMPT,
            user: `RESEARCH.txt:\n\n${researchRevised}`,
            maxTokens: 3500,
            label: "avatar",
          }),
      });
    }
    if (needOfferBrief) {
      tasks.push({
        key: "offerBrief",
        run: () =>
          anthropicMessage({
            system: OFFER_BRIEF_PROMPT,
            user: `RESEARCH.txt:\n\n${researchRevised}`,
            maxTokens: 3500,
            label: "offer brief",
          }),
      });
    }
    if (needBeliefs) {
      tasks.push({
        key: "beliefs",
        run: () =>
          anthropicMessage({
            system: NECESSARY_BELIEFS_PROMPT,
            user: `RESEARCH.txt:\n\n${researchRevised}`,
            maxTokens: 3500,
            label: "necessary beliefs",
          }),
      });
    }

    const settled = await Promise.allSettled(tasks.map((t) => t.run()));

    const updates: Partial<Run> = { last_updated_at: now() };
    const failures: string[] = [];
    settled.forEach((res, i) => {
      const { key } = tasks[i];
      if (res.status === "fulfilled" && res.value) {
        if (key === "avatar") {
          avatar = res.value;
          updates.step_avatar = avatar;
        } else if (key === "offerBrief") {
          offerBrief = res.value;
          updates.step_offer_brief = offerBrief;
          updates.brand_name = extractBrandName(offerBrief);
        } else {
          necessaryBeliefs = res.value;
          updates.step_necessary_beliefs = necessaryBeliefs;
        }
      } else {
        const reason =
          res.status === "rejected"
            ? res.reason instanceof Error
              ? res.reason.message
              : String(res.reason)
            : "returned empty";
        failures.push(`${key}: ${reason}`);
      }
    });

    // Persist successes first so a resume skips the completed docs.
    await updateRun(runId, updates);

    if (failures.length > 0) {
      throw new Error(`Stage 1 parallel docs failed — ${failures.join("; ")}`);
    }
  }

  // ── Sub-step 5: Chief final (skip if already in DB) ──
  let chiefFinal = run.step_chief_final ?? "";
  if (!chiefFinal) {
    await updateRun(runId, { current_step: "Stage 1: Final chief review", last_updated_at: now() });
    chiefFinal = await anthropicMessage({
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
    await updateRun(runId, { step_chief_final: chiefFinal, last_updated_at: now() });
  }

  // ── Sub-step 6: Final revisions (skip if revised docs already in DB) ──
  const hasRevisedDocs =
    run.step_avatar_revised || run.step_offer_brief_revised || run.step_necessary_beliefs_revised;
  if (!hasRevisedDocs) {
    await updateRun(runId, { current_step: "Stage 1: Applying final revisions", last_updated_at: now() });
    let avatarRevised = avatar;
    let offerBriefRevised = offerBrief;
    let necessaryBeliefsRevised = necessaryBeliefs;
    if (chiefFinal && !chiefFinal.includes("NO REVISIONS REQUIRED")) {
      const revisions = parseRevisions(chiefFinal);
      // Each revision targets a distinct document, so apply them concurrently.
      await Promise.all(
        revisions.map(async (rev) => {
          if (rev.docName === "AVATAR.txt") {
            avatarRevised = await reviseDoc(avatar, "AVATAR.txt", rev.changes);
          } else if (rev.docName === "OFFER_BRIEF.txt") {
            offerBriefRevised = await reviseDoc(offerBrief, "OFFER_BRIEF.txt", rev.changes);
          } else if (rev.docName === "NECESSARY_BELIEFS.txt") {
            necessaryBeliefsRevised = await reviseDoc(necessaryBeliefs, "NECESSARY_BELIEFS.txt", rev.changes);
          }
        })
      );
    }
    await updateRun(runId, {
      step_avatar_revised: avatarRevised,
      step_offer_brief_revised: offerBriefRevised,
      step_necessary_beliefs_revised: necessaryBeliefsRevised,
      last_updated_at: now(),
    });
  }

  // ── Sub-step 7: One-pager synthesis (the only Stage 1 output user sees) ──
  if (!run.stage1_one_pager) {
    await updateRun(runId, { current_step: "Stage 1: Synthesizing one-pager summary", last_updated_at: now() });

    // Refetch to get the just-written revisions
    const fresh = await getRun(runId);
    const researchForOnePager = fresh?.step_research_revised ?? research;
    const avatarForOnePager = fresh?.step_avatar_revised ?? avatar;
    const offerForOnePager = fresh?.step_offer_brief_revised ?? offerBrief;
    const beliefsForOnePager = fresh?.step_necessary_beliefs_revised ?? necessaryBeliefs;

    const stage1Feedback = await buildStage1FeedbackBlock();
    const onePagerSystem = await getPrompt("stage1");
    const onePager = await anthropicMessage({
      system: onePagerSystem + stage1Feedback,
      user: [
        "Here are the research documents for this product. Synthesize them into the one-pager.",
        "",
        "PRODUCT RESEARCH (identification, market, competitive, product analysis, visual):",
        researchForOnePager,
        "",
        "---",
        "",
        "CUSTOMER AVATAR:",
        avatarForOnePager,
        "",
        "---",
        "",
        "OFFER BRIEF:",
        offerForOnePager,
        "",
        "---",
        "",
        "NECESSARY BELIEFS:",
        beliefsForOnePager,
      ].join("\n"),
      maxTokens: 2000,
      label: "one-pager synthesis",
      // Pure summarization of finished docs — Haiku is enough.
      model: CLAUDE_HAIKU_MODEL,
    });
    if (!onePager) throw new Error("Stage 1: one-pager synthesis returned empty");
    await updateRun(runId, { stage1_one_pager: onePager, last_updated_at: now() });
  }
}

export async function runStage2(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage2", current_step: "Stage 2: Preparing prompt", last_updated_at: now() });

  const stage1Output = run.step_research_revised ?? run.step_research ?? "";
  if (!stage1Output) throw new Error("No Stage 1 output to run Stage 2");

  const systemPrompt = (await getPrompt("stage2")) + (await buildStage2FeedbackBlock());
  const productName = run.brand_name ?? run.product_name ?? "";

  await updateRun(runId, { current_step: "Stage 2: Generating German copy (≈30–60s)", last_updated_at: now() });

  const output = await anthropicMessage({
    system: systemPrompt,
    user: `PRODUCT NAME: ${productName || "(not provided — choose the best name from the research)"}\n\nRESEARCH BRIEF (Stage 1 output):\n${stage1Output}\n\nProduce the complete German copy kit now.`,
    maxTokens: 8192,
    label: "stage 2 German copy",
  });
  if (!output) throw new Error("Stage 2 produced no output");

  await updateRun(runId, {
    stage2_output: output,
    current_step: "Stage 2: Saving output",
    last_updated_at: now(),
  });
}

// ── Manual Stage 2 trigger (after the Stage 1 QC gate) ───────────────────────

/**
 * Run Stage 2 for a run that's paused at `awaiting_stage2_approval`, then
 * move the run to `awaiting_user` so the existing image-approval / Stage 3
 * flow can take over. Designed to be called from
 * POST /api/runs/[id]/start-stage2.
 */
export async function runStage2Manually(runId: number): Promise<void> {
  if (RUNNING_PIPELINES.has(runId)) {
    console.warn(`Stage 2 manual trigger ${runId} skipped — pipeline already running.`);
    return;
  }
  RUNNING_PIPELINES.add(runId);
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");
    if (!run.stage1_one_pager) {
      throw new Error("Cannot start Stage 2 — Stage 1 one-pager is missing");
    }

    await updateRun(runId, { error_message: null, last_updated_at: now() });

    await runStage2(runId, run);

    await updateRun(runId, {
      status: "awaiting_user",
      current_step: "Awaiting image approval for Stage 3",
      last_updated_at: now(),
      completed_at: now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Stage 2 manual trigger ${runId} failed:`, message);
    await updateRun(runId, {
      status: "failed",
      error_message: message,
      last_updated_at: now(),
    }).catch(() => {});
  } finally {
    RUNNING_PIPELINES.delete(runId);
  }
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

    // Set stage1 status immediately so the UI never sees a "scraping" state.
    await updateRun(runId, { status: "stage1", current_step: "Stage 1: Product Identification (1/6)", last_updated_at: now() });

    await runScrape(runId, run);

    const runAfterScrape = await getRun(runId);
    if (!runAfterScrape) throw new Error("Run not found after scrape");
    await runStage1(runId, runAfterScrape);

    // Pause at the new QC gate between Stage 1 and Stage 2. The user reviews
    // the one-pager, optionally edits or AI-regenerates it, then triggers
    // Stage 2 via POST /api/runs/[id]/start-stage2.
    await updateRun(runId, {
      status: "awaiting_stage2_approval",
      current_step: "Stage 1 complete — awaiting your review before Stage 2",
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
      // Run from the top — scrape, then Stage 1 — directly. Delegating to
      // runPipeline does NOT work here: its anti-double-run guards (the
      // RUNNING_PIPELINES lock and the "last_updated_at < 60s" recency check)
      // both trip on resumePipeline's own lock and timestamp, so the call is
      // silently skipped and the resume does nothing.
      await updateRun(runId, { status: "stage1", last_updated_at: now() });
      await runScrape(runId, run);
      const freshRun = await getRun(runId);
      if (!freshRun) throw new Error("Run not found");
      await runStage1(runId, freshRun);
      await updateRun(runId, {
        status: "awaiting_stage2_approval",
        current_step: "Stage 1 complete — awaiting your review before Stage 2",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "scrape") {
      const freshRun = await getRun(runId);
      if (!freshRun) throw new Error("Run not found");
      await runStage1(runId, freshRun);
      // Pause at the Stage 1 → Stage 2 QC gate. User triggers Stage 2 manually.
      await updateRun(runId, {
        status: "awaiting_stage2_approval",
        current_step: "Stage 1 complete — awaiting your review before Stage 2",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage1") {
      // Check if stage1 is actually complete (one-pager is the final sub-step now)
      if (!run.step_research_revised || !run.step_avatar || !run.step_offer_brief ||
          !run.step_necessary_beliefs || !run.step_chief_final ||
          !run.step_avatar_revised || !run.stage1_one_pager) {
        // Stage 1 was partially done — re-run (granular skipping inside runStage1)
        const freshRun = await getRun(runId);
        if (!freshRun) throw new Error("Run not found");
        await runStage1(runId, freshRun);
      }
      // Pause at the Stage 1 → Stage 2 QC gate. User triggers Stage 2 manually.
      await updateRun(runId, {
        status: "awaiting_stage2_approval",
        current_step: "Stage 1 complete — awaiting your review before Stage 2",
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

// ── Stuck-run watchdog ────────────────────────────────────────────────────────
// Process-level safety net: every 2 min, find runs that have been in an active
// status with no DB update for 8+ min — meaning the fire-and-forget pipeline
// was killed (dev-server restart, crash) — and auto-resume them. Granular
// resume means no work is lost. resumePipeline's own RUNNING_PIPELINES guard
// makes this a no-op for runs still genuinely executing in this process.
const WATCHDOG_STALE_MS = 8 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;

async function watchdogSweep(): Promise<void> {
  try {
    const result = await db.execute(
      `SELECT id, last_updated_at FROM runs
       WHERE status IN ('pending', 'scraping', 'stage1', 'stage2')`,
    );
    const cutoff = Date.now() - WATCHDOG_STALE_MS;
    const rows = result.rows as unknown as { id: number; last_updated_at: string | null }[];
    for (const row of rows) {
      if (!row.last_updated_at) continue;
      if (new Date(row.last_updated_at).getTime() >= cutoff) continue;
      if (RUNNING_PIPELINES.has(row.id)) continue; // still running here — leave it
      console.warn(`[watchdog] run ${row.id} stale — auto-resuming`);
      resumePipeline(row.id).catch((err) =>
        console.error(`[watchdog] resume ${row.id} failed:`, err),
      );
    }
  } catch (err) {
    console.error("[watchdog] sweep failed:", err);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __pipelineWatchdog: ReturnType<typeof setInterval> | undefined;
}

// Guarded so dev hot-reload doesn't stack multiple timers in one process.
if (!globalThis.__pipelineWatchdog) {
  globalThis.__pipelineWatchdog = setInterval(watchdogSweep, WATCHDOG_INTERVAL_MS);
}
