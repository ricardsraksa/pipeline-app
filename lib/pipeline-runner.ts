import Anthropic from "@anthropic-ai/sdk";
import { getRun, updateRun, recordPromptUsed, recordUsage, db } from "./db";
import { scraplingScrape } from "./scrapling";
import { buildAnalystContent, parseProductScrape, type ProductScrape, type ProductScrapePage } from "./product";
import { generateAngles } from "./angles-generate";
import { anglesBlock, parseSelectedAngles } from "./angles";
import { fillProductTab, googleDocConfigured } from "./google/docs";
import type { Run } from "./db";
import { getModel } from "./models";
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
import { structureStage2Copy } from "./stage2/format";
import {
  buildStage1FeedbackBlock,
  buildStage2FeedbackBlock as buildStage2NotesBlock,
} from "./feedback";

// timeout: a hung Anthropic request fails within 2 min instead of the SDK's
// 10-min default, so a stalled Stage 1 call surfaces as a resumable failure
// rather than an indefinitely "stuck" run.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });
// Models are resolved per logical role via getModel() (lib/models.ts) — DB
// selection → env override → default. Stage 1 reasoning is the default role for
// anthropicMessage; mechanical chores and Stage 2 pass their roles explicitly.
// Hard cap on each scrape HTTP call — a slow/unresponsive supplier site must
// not hang the whole pipeline. Unbounded scrape fetches were the primary cause
// of runs stuck at Stage 1.

// In-memory lock to prevent a runId from being executed concurrently in the
// same process (covers the common case of double-resume clicks). On a multi-
// instance deploy this is not bulletproof, but combined with the DB status
// check below it's good enough.
const RUNNING_PIPELINES = new Set<number>();

// Cooperative cancellation. The background pipeline has no built-in abort, so
// "kill run" sets the run's status to 'cancelled' AND flags it here. The
// runner calls guardCancel() at every stage boundary and bails (throwing
// PipelineCancelled) rather than continuing into the next expensive call.
const CANCELLED = new Set<number>();
export class PipelineCancelled extends Error {
  constructor() { super("Run cancelled by user"); this.name = "PipelineCancelled"; }
}
/** Flag a run for cancellation. The next guardCancel() in its pipeline throws. */
export function requestCancel(runId: number): void {
  CANCELLED.add(runId);
}
async function guardCancel(runId: number): Promise<void> {
  if (CANCELLED.has(runId)) throw new PipelineCancelled();
  // The in-memory flag dies on a server restart; the DB status doesn't. A run
  // cancelled just before a redeploy must still stop at the next boundary, so
  // re-check the durable status too (stage boundaries are infrequent — a
  // handful of reads per run).
  try {
    const r = await db.execute({ sql: "SELECT status FROM runs WHERE id = ?", args: [runId] });
    if ((r.rows[0] as unknown as { status?: string })?.status === "cancelled") {
      throw new PipelineCancelled();
    }
  } catch (err) {
    if (err instanceof PipelineCancelled) throw err;
    // DB hiccup — don't kill the run over a failed cancellation check.
    console.error(`[guardCancel] status check failed for run ${runId}:`, err);
  }
}
/** Catch-block helper: a cancelled run lands on 'cancelled', everything else
 *  on 'failed' with the error message. Always clears the cancel flag. */
async function markStopped(runId: number, err: unknown): Promise<void> {
  if (err instanceof PipelineCancelled) {
    await updateRun(runId, {
      status: "cancelled",
      current_step: "Cancelled by user",
      error_message: null,
      last_updated_at: now(),
    }).catch((e) => console.error(`[markStopped] failed to mark run ${runId} cancelled:`, e));
  } else {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: "failed", error_message: message, last_updated_at: now() })
      .catch((e) => console.error(`[markStopped] failed to mark run ${runId} failed:`, e));
  }
  CANCELLED.delete(runId);
}

function now(): string {
  return new Date().toISOString();
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
      // Only transient failures are worth re-billing: 429, 5xx, overload,
      // timeouts, connection drops. A 4xx is deterministic — retrying it just
      // multiplies the cost of the same failure.
      const status = (err as { status?: number })?.status;
      const transient =
        status === 429 ||
        (typeof status === "number" && status >= 500) ||
        (typeof status !== "number" &&
          /timeout|timed out|overloaded|econnreset|econnrefused|socket|network|fetch failed/i.test(message));
      if (!transient) throw err;
      if (attempt === maxRetries) break;
      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[${opts.label}] attempt ${attempt + 1} failed: ${message}. Retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function anthropicMessage(args: {
  // A plain string stays uncached (right for Stage 1's one-shot sub-step
  // prompts). Pass an array of text blocks with cache_control to cache a large
  // static prefix that repeats within the 5-min TTL (e.g. Stage 2).
  system: string | Anthropic.TextBlockParam[];
  user: string | Anthropic.MessageParam["content"];
  maxTokens: number;
  label: string;
  model?: string;
  /** Per-request timeout override (ms). Defaults to the client's 120s.
   *  Opus is slower than Sonnet, so the Stage 2 call passes a larger value. */
  timeoutMs?: number;
  /** Run to attribute this call's token usage to in the cost tracker. */
  runId?: number;
}): Promise<string> {
  // Resolve the model once, here — the retry thunk below is not async, so the
  // await can't live inside it. Default role is Stage 1 reasoning; callers that
  // pass an explicit model (mechanical / Stage 2) override it.
  const model = args.model ?? (await getModel("stage1"));
  const msg = await withRetry(
    () =>
      anthropic.messages.create(
        {
          model,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: "user", content: args.user }],
        },
        args.timeoutMs ? { timeout: args.timeoutMs } : undefined,
      ),
    { label: args.label },
  );
  void recordUsage(args.runId ?? null, args.label, model, msg.usage);
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
      `SELECT stage2_output FROM runs WHERE feedback_stage2 = 'up' AND stage2_output IS NOT NULL ORDER BY created_at DESC LIMIT 3`
    );
    const rows = result.rows as unknown as Pick<Run, "stage2_output">[];
    if (!rows.length) return noteBlock;
    // ~600 chars shows the actual structure (name + tagline + first benefits),
    // not just the opening line. 3 examples keeps the uncached suffix lean.
    const summaries = rows.map((r) => (r.stage2_output as string).slice(0, 600));
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

async function reviseDoc(runId: number, original: string, docType: string, changes: string): Promise<string> {
  const text = await anthropicMessage({
    system: REVISE_DOC_PROMPT,
    user: `Document type: ${docType}\n\nOriginal document:\n\n${original}\n\n---\n\nRequired changes:\n\n${changes}`,
    maxTokens: 4000,
    label: `revise ${docType}`,
    runId,
    // Mechanical doc editing against an explicit changelist — the cheap model.
    model: await getModel("mechanical"),
  });
  return text || original;
}

// ── Last completed stage detector ────────────────────────────────────────────

export type LastStage = "none" | "product" | "scrape" | "stage1" | "stage2" | "stage3-prompts" | "stage3-images";

export function getLastCompletedStage(run: Run): LastStage {
  if (run.generated_images) return "stage3-images";
  if (run.image_prompts) return "stage3-prompts";
  if (run.stage2_output) return "stage2";
  // Stage 1 is only "complete" once the one-pager exists (it's the final sub-step now)
  if (run.stage1_one_pager) return "stage1";
  // "scrape" = the product gate was passed (approval writes scraper_data) or a
  // pre-Stage-1 run that already had research; both continue into research.
  if (run.scraper_data || run.step_research) return "scrape";
  if (run.product_scrape && !run.product_approved_at) return "product";
  return "none";
}

// ── Core stage runners ────────────────────────────────────────────────────────

// ── Stage 1 · Product ─────────────────────────────────────────────────────────
// scrapling reads every pasted URL, the analyst model writes the 120-word
// description, then the run parks at the product gate until the operator
// approves the text and ticks the photos.

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); }
}

export async function runProductStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await updateRun(runId, { status: "product", current_step: "Stage 1: Reading the product page", last_updated_at: now() });

  const targets: { url: string; role: "product" | "competitor" }[] = [];
  if (run.product_url?.trim()) targets.push({ url: run.product_url.trim(), role: "product" });
  for (const u of safeJson<string[]>(run.competitor_urls, [])) targets.push({ url: u, role: "competitor" });
  if (!targets.length) throw new Error("Stage 1: no product URL on this run");

  const pages: ProductScrapePage[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    await guardCancel(runId);
    await updateRun(runId, {
      current_step: `Stage 1: Reading ${t.role === "product" ? "product" : "competitor"} page ${i + 1}/${targets.length} — ${hostOf(t.url)}`,
      last_updated_at: now(),
    });
    const r = await scraplingScrape(t.url);
    if (r.ok) {
      const { url: _u, ...rest } = r.data;
      pages.push({ url: t.url, role: t.role, ok: true, ...rest });
    } else {
      console.warn(`[product] run ${runId} scrape failed for ${t.url}: ${r.error}`);
      pages.push({ url: t.url, role: t.role, ok: false, error: r.error, rateLimited: r.rateLimited, deferred: r.deferred, image_urls: [], description_image_urls: [] });
    }
  }

  const scrape: ProductScrape = { pages, scraped_at: now(), source: "hosted" };
  const productPage = pages.find((p) => p.role === "product");
  await updateRun(runId, {
    product_scrape: JSON.stringify(scrape),
    scraped_image_urls: JSON.stringify(productPage?.image_urls ?? []),
    // A fresh scrape invalidates any earlier description / selection.
    product_description_ai: null,
    product_description_edited: null,
    product_selected_images: null,
    last_updated_at: now(),
  });

  await describeProduct(runId);
  await parkAtProductGate(runId);
}

/** Park the run at the Stage 1 gate with a step line that says what's needed. */
export async function parkAtProductGate(runId: number): Promise<void> {
  const run = await getRun(runId);
  const scrape = parseProductScrape(run?.product_scrape);
  const productPage = scrape?.pages.find((p) => p.role === "product");
  const productOk = Boolean(productPage?.ok);
  await updateRun(runId, {
    status: "awaiting_product_approval",
    current_step: productOk
      ? "Stage 1 complete — review the description and pick the photos"
      : productPage?.deferred
        ? "Stage 1: waiting for your Mac to scrape the page"
        : "Stage 1: the product page couldn't be read — scrape it locally or describe it yourself",
    last_updated_at: now(),
  });
}

/**
 * (Re)write the analyst description from the stored scrape. Returns null when
 * no page could be read (the gate then asks the operator to describe it).
 */
export async function describeProduct(runId: number): Promise<string | null> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const scrape = parseProductScrape(run.product_scrape);
  if (!scrape || !scrape.pages.some((p) => p.ok)) return null;

  await updateRun(runId, { current_step: "Stage 1: Writing the product description", last_updated_at: now() });
  const system = await getPrompt("product");
  await recordPromptUsed(runId, "product", system);
  const text = (await anthropicMessage({
    system,
    user: buildAnalystContent(scrape),
    // 200 words is ~300 tokens; the headroom is for the model's own slack.
    maxTokens: 1200,
    label: "product description",
    runId,
    model: await getModel("product"),
  })).trim();
  if (!text) throw new Error("Stage 1: the analyst returned an empty description");
  await updateRun(runId, { product_description_ai: text, product_description_edited: null, last_updated_at: now() });
  return text;
}

async function pauseAtResearchGate(runId: number): Promise<void> {
  await updateRun(runId, {
    status: "awaiting_stage2_approval",
    current_step: "Stage 2 complete — review the research and pick an angle",
    last_updated_at: now(),
  });
}

/**
 * Called by the approve-product route after it has written the final
 * description + photo selection onto the run: runs research, then pauses at
 * the research gate exactly like the old top-of-pipeline path did.
 */
export async function continueAfterProductApproval(runId: number): Promise<void> {
  if (RUNNING_PIPELINES.has(runId)) {
    console.warn(`Pipeline ${runId} is already executing — skipping duplicate research start.`);
    return;
  }
  RUNNING_PIPELINES.add(runId);
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");
    await updateRun(runId, { status: "stage1", error_message: null, last_updated_at: now() });
    await runStage1(runId, run);
    await pauseAtResearchGate(runId);
  } catch (err) {
    console.error(`Pipeline ${runId} stopped:`, err instanceof Error ? err.message : String(err));
    await markStopped(runId, err);
  } finally {
    RUNNING_PIPELINES.delete(runId);
    CANCELLED.delete(runId);
  }
}

async function runStage1(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage1", last_updated_at: now() });

  const scraperData = safeJson<{
    scraped_text?: string;
    competitor_scraped?: Array<{ url: string; text: string }>;
  }>(run.scraper_data, {});

  const inputs: ResearchInputs = {
    runId,
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
    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Identifying product (1/5)", last_updated_at: now() });
    const identify = await runIdentify(inputs);

    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Market overview (2/5)", last_updated_at: now() });
    const market = await runMarket(inputs, identify);

    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Competitive landscape (3/5)", last_updated_at: now() });
    const competitive = await runCompetitive(inputs, identify, market);

    // Product analysis and visual strategy both depend only on identify +
    // market + competitive — neither consumes the other — so run them together.
    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Product analysis + visual strategy (4/5)", last_updated_at: now() });
    const [productAnalysis, visual] = await Promise.all([
      runProductAnalysis(inputs, identify, market, competitive),
      runVisual(inputs, identify, market, competitive),
    ]);

    research = [identify, market, competitive, productAnalysis, visual].filter(Boolean).join("\n\n");
    if (!research) throw new Error("Stage 2 produced no research output");

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
      current_step: "Stage 2: Avatar, offer brief & necessary beliefs (parallel)",
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
            runId,
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
            runId,
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
            runId,
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
      throw new Error(`Stage 2 parallel docs failed — ${failures.join("; ")}`);
    }
  }

  // ── Sub-step 5: Chief final (skip if already in DB) ──
  let chiefFinal = run.step_chief_final ?? "";
  if (!chiefFinal) {
    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Final chief review", last_updated_at: now() });
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
      runId,
    });
    await updateRun(runId, { step_chief_final: chiefFinal, last_updated_at: now() });
  }

  // ── Sub-step 6: Final revisions (skip if revised docs already in DB) ──
  const hasRevisedDocs =
    run.step_avatar_revised || run.step_offer_brief_revised || run.step_necessary_beliefs_revised;
  if (!hasRevisedDocs) {
    await updateRun(runId, { current_step: "Stage 2: Applying final revisions", last_updated_at: now() });
    let avatarRevised = avatar;
    let offerBriefRevised = offerBrief;
    let necessaryBeliefsRevised = necessaryBeliefs;
    if (chiefFinal && !chiefFinal.includes("NO REVISIONS REQUIRED")) {
      const revisions = parseRevisions(chiefFinal);
      // Each revision targets a distinct document, so apply them concurrently.
      await Promise.all(
        revisions.map(async (rev) => {
          if (rev.docName === "AVATAR.txt") {
            avatarRevised = await reviseDoc(runId, avatar, "AVATAR.txt", rev.changes);
          } else if (rev.docName === "OFFER_BRIEF.txt") {
            offerBriefRevised = await reviseDoc(runId, offerBrief, "OFFER_BRIEF.txt", rev.changes);
          } else if (rev.docName === "NECESSARY_BELIEFS.txt") {
            necessaryBeliefsRevised = await reviseDoc(runId, necessaryBeliefs, "NECESSARY_BELIEFS.txt", rev.changes);
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
    await updateRun(runId, { current_step: "Stage 2: Synthesizing one-pager summary", last_updated_at: now() });

    // Refetch to get the just-written revisions
    const fresh = await getRun(runId);
    const researchForOnePager = fresh?.step_research_revised ?? research;
    const avatarForOnePager = fresh?.step_avatar_revised ?? avatar;
    const offerForOnePager = fresh?.step_offer_brief_revised ?? offerBrief;
    const beliefsForOnePager = fresh?.step_necessary_beliefs_revised ?? necessaryBeliefs;

    const stage1Feedback = await buildStage1FeedbackBlock();
    const onePagerSystem = await getPrompt("stage1");
    // Audit trail: snapshot the exact system prompt this run's one-pager used.
    await recordPromptUsed(runId, "stage1", onePagerSystem + stage1Feedback);
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
      runId,
      // Pure summarization of finished docs — the cheap model.
      model: await getModel("mechanical"),
    });
    if (!onePager) throw new Error("Stage 2: one-pager synthesis returned empty");
    await updateRun(runId, { stage1_one_pager: onePager, last_updated_at: now() });
  }

  // ── Sub-step 8: Positioning angles (the operator picks one at the gate) ──
  if (!run.product_angles) {
    await guardCancel(runId);
    await updateRun(runId, { current_step: "Stage 2: Proposing positioning angles", last_updated_at: now() });
    await generateAngles(runId);
  }
}

export async function runStage2(runId: number, run: Run): Promise<void> {
  await guardCancel(runId);
  await updateRun(runId, { status: "stage2", current_step: "Stage 3: Preparing prompt", last_updated_at: now() });

  const stage1Output = run.step_research_revised ?? run.step_research ?? "";
  if (!stage1Output) throw new Error("No research output to run the copy stage");

  // Split the system into a cached static prefix (the big ~230-line prompt,
  // re-sent verbatim on every Stage 2 run + every regeneration) and an uncached
  // feedback suffix (changes per run). The cache breakpoint sits after the
  // static block, so the expensive Opus input prefix is read from cache on
  // repeat calls within the 5-min TTL.
  const stage2Static = await getPrompt("stage2");
  const stage2Feedback = await buildStage2FeedbackBlock();
  // Audit trail: snapshot the exact system prompt (static + feedback suffix)
  // this run's copy was generated with.
  await recordPromptUsed(runId, "stage2", stage2Static + (stage2Feedback.trim() ? stage2Feedback : ""));
  const stage2System: Anthropic.TextBlockParam[] = [
    // 1h TTL: runs are batched in sessions, but usually more than 5 minutes
    // apart — the tracker showed a cache WRITE on every run and zero reads.
    { type: "text", text: stage2Static, cache_control: { type: "ephemeral", ttl: "1h" } },
    ...(stage2Feedback.trim() ? [{ type: "text" as const, text: stage2Feedback }] : []),
  ];
  const productName = run.brand_name ?? run.product_name ?? "";
  // The angle the operator chose at the gate. Everything in the kit is built
  // around this one problem, not a generic best-X pitch.
  const angle = anglesBlock(parseSelectedAngles(run.product_angle_selected));
  const angleSection = angle
    ? `\n\nPOSITIONING ANGLE(S) (chosen by the operator — build the ENTIRE copy kit around the PRIMARY angle's problem and mechanism; the headline, hero benefit and first section serve it; supporting angles, if any, appear in later benefits, sections, FAQs and objections; never drift back to a generic "best X" or "only Y" pitch):\n${angle}`
    : "";

  await guardCancel(runId);
  await updateRun(runId, { current_step: "Stage 3: Generating copy (≈1–3 min)", last_updated_at: now() });

  const output = await anthropicMessage({
    system: stage2System,
    user: `PRODUCT NAME: ${productName || "(not provided — choose the best name from the research)"}\n\nRESEARCH BRIEF (Stage 1 output):\n${stage1Output}${angleSection}\n\nProduce the complete copy kit now.`,
    maxTokens: 8192,
    label: "stage 2 copy",
      runId,
    model: await getModel("stage2"),
    // Opus + an 8k-token copy kit can run well past Sonnet's pace;
    // give it 4 minutes before the client aborts.
    timeoutMs: 240_000,
  });
  if (!output) throw new Error("Stage 3 produced no output");

  await updateRun(runId, {
    stage2_output: output,
    current_step: "Stage 3: Saving output",
    last_updated_at: now(),
  });

  // Best-effort: derive the structured per-field JSON from the canonical text.
  // Never blocks or fails the run — the text is the source of truth.
  try {
    const structured = await structureStage2Copy(output);
    if (structured) {
      // Stage 2 names the product properly ("BrandName Product Category"), which
      // beats the Stage 1 brand-word guess the run has been displaying — adopt it
      // as the run name. brand_name is what the UI shows, and the operator can
      // still rename manually afterwards.
      const stage2Name = structured.product_name?.trim();
      await updateRun(runId, {
        stage2_json: JSON.stringify(structured),
        ...(stage2Name ? { brand_name: stage2Name } : {}),
        last_updated_at: now(),
      });
      // Auto-fill the product's tab in the master Google Doc. Fire-and-forget:
      // the doc is a convenience mirror and must never fail (or slow) a run.
      // Needs the run's product code (picks the tab) — refetched in case the
      // operator set it after starting the run.
      if (googleDocConfigured()) {
        void (async () => {
          const fresh = await getRun(runId);
          let competitorUrl: string | undefined;
          try { competitorUrl = (JSON.parse(fresh?.competitor_urls ?? "[]") as string[])[0]; } catch { /* none */ }
          const r = await fillProductTab({
            productCode: fresh?.product_code ?? "",
            json: structured,
            overview: {
              productName: stage2Name ?? structured.product_name ?? undefined,
              productUrl: fresh?.product_url ?? undefined,
              competitorUrl,
            },
          });
          const ts = now();
          if (r.ok) await updateRun(runId, { gdoc_appended_at: ts, gdoc_append_error: null, last_updated_at: ts });
          else await updateRun(runId, { gdoc_append_error: r.error ?? "unknown", last_updated_at: ts });
        })().catch((e) => console.error(`[google-doc] run ${runId}:`, e));
      }
    }
  } catch (err) {
    console.error(`[stage2 structure] run ${runId}:`, err);
  }
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
    console.warn(`Stage 3 manual trigger ${runId} skipped — pipeline already running.`);
    return;
  }
  RUNNING_PIPELINES.add(runId);
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");
    if (!run.stage1_one_pager) {
      throw new Error("Cannot start Stage 3 — the research one-pager is missing");
    }

    await updateRun(runId, { error_message: null, last_updated_at: now() });

    await runStage2(runId, run);

    await updateRun(runId, {
      status: "awaiting_user",
      current_step: "Awaiting image approval for Stage 4",
      last_updated_at: now(),
      completed_at: now(),
    });
  } catch (err) {
    console.error(`Stage 3 manual trigger ${runId} stopped:`, err instanceof Error ? err.message : String(err));
    await markStopped(runId, err);
  } finally {
    RUNNING_PIPELINES.delete(runId);
    CANCELLED.delete(runId);
  }
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

const ACTIVE_DB_STATUSES = new Set(["product", "scraping", "stage1", "stage2"]);

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

    // Stage 1 · Product: scrape + analyst description, then park at the
    // product gate. Research starts from POST /api/runs/[id]/approve-product.
    await runProductStage(runId);
  } catch (err) {
    console.error(`Pipeline ${runId} stopped:`, err instanceof Error ? err.message : String(err));
    await markStopped(runId, err);
  } finally {
    RUNNING_PIPELINES.delete(runId);
    CANCELLED.delete(runId);
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
      // Run from the top — the product stage — directly. Delegating to
      // runPipeline does NOT work here: its anti-double-run guards (the
      // RUNNING_PIPELINES lock and the "last_updated_at < 60s" recency check)
      // both trip on resumePipeline's own lock and timestamp, so the call is
      // silently skipped and the resume does nothing.
      await runProductStage(runId);
      return;
    }

    if (lastStage === "product") {
      // Scrape exists but the gate wasn't passed: make sure a description
      // exists (the analyst call may have been what died), then park again.
      if (!run.product_description_ai) await describeProduct(runId);
      await parkAtProductGate(runId);
      return;
    }

    if (lastStage === "scrape") {
      const freshRun = await getRun(runId);
      if (!freshRun) throw new Error("Run not found");
      await updateRun(runId, { status: "stage1", last_updated_at: now() });
      await runStage1(runId, freshRun);
      await pauseAtResearchGate(runId);
      return;
    }

    if (lastStage === "stage1") {
      // Check if stage1 is actually complete (one-pager is the final sub-step now)
      if (!run.step_research_revised || !run.step_avatar || !run.step_offer_brief ||
          !run.step_necessary_beliefs || !run.step_chief_final ||
          !run.step_avatar_revised || !run.stage1_one_pager || !run.product_angles) {
        // Stage 1 was partially done — re-run (granular skipping inside runStage1)
        const freshRun = await getRun(runId);
        if (!freshRun) throw new Error("Run not found");
        await runStage1(runId, freshRun);
      }
      await pauseAtResearchGate(runId);
      return;
    }

    if (lastStage === "stage2") {
      await updateRun(runId, {
        status: "awaiting_user",
        current_step: "Awaiting image approval for Stage 4",
        last_updated_at: now(),
      });
      return;
    }

    if (lastStage === "stage3-prompts") {
      await updateRun(runId, {
        status: "awaiting_qc",
        current_step: "Awaiting prompt review for Stage 4",
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
    console.error(`Resume ${runId} stopped:`, err instanceof Error ? err.message : String(err));
    await markStopped(runId, err);
  } finally {
    RUNNING_PIPELINES.delete(runId);
    CANCELLED.delete(runId);
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
      `SELECT id, status, last_updated_at, stage3_hero_image_url, stage3_remaining_prompts
       FROM runs
       WHERE status IN ('pending', 'product', 'scraping', 'stage1', 'stage2',
                        'generating_hero', 'generating_remaining')`,
    );
    const cutoff = Date.now() - WATCHDOG_STALE_MS;
    const rows = result.rows as unknown as {
      id: number; status: string | null; last_updated_at: string | null;
      stage3_hero_image_url: string | null; stage3_remaining_prompts: string | null;
    }[];
    for (const row of rows) {
      if (!row.last_updated_at) continue;
      if (new Date(row.last_updated_at).getTime() >= cutoff) continue;
      if (RUNNING_PIPELINES.has(row.id)) continue; // still running here — leave it

      // Stage 3 statuses aren't part of resumePipeline (the hero flow is
      // user-triggered API routes). A run wedged there means the route died
      // mid-generation — flip it back to the nearest recoverable gate so the
      // UI offers the next action instead of an eternal spinner.
      if (row.status === "generating_hero" || row.status === "generating_remaining") {
        const next =
          row.status === "generating_remaining" && row.stage3_remaining_prompts ? "awaiting_qc"
          : row.stage3_hero_image_url ? "awaiting_hero_qc"
          : "awaiting_user";
        console.warn(`[watchdog] run ${row.id} stale in ${row.status} — flipping to ${next}`);
        updateRun(row.id, {
          status: next,
          current_step: null,
          error_message: "Stage 4 generation was interrupted (server restart) — pick up from here.",
          last_updated_at: new Date().toISOString(),
        }).catch((err) => console.error(`[watchdog] flip ${row.id} failed:`, err));
        continue;
      }

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
