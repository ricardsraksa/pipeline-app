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
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: REVISE_DOC_PROMPT,
    messages: [{ role: "user", content: `Document type: ${docType}\n\nOriginal document:\n\n${original}\n\n---\n\nRequired changes:\n\n${changes}` }],
  });
  return msg.content.find((b) => b.type === "text")?.text ?? original;
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
  const competitorUrls: string[] = (() => {
    try { return run.competitor_urls ? JSON.parse(run.competitor_urls) : []; } catch { return []; }
  })();

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
    const existing = JSON.parse((await getRun(runId))?.scraper_data ?? "{}");
    await updateRun(runId, {
      scraper_data: JSON.stringify({ ...existing, competitor_scraped: competitorScraped }),
      last_updated_at: now(),
    });
  }
}

async function runStage1(runId: number, run: Run): Promise<void> {
  await updateRun(runId, { status: "stage1", current_step: "Stage 1: Identifying product (1/5)", last_updated_at: now() });

  const scraperData = (() => {
    try { return run.scraper_data ? JSON.parse(run.scraper_data) : {}; } catch { return {}; }
  })();

  const inputs: ResearchInputs = {
    product_url: run.product_url,
    product_description: run.product_description ?? undefined,
    scraped_text: scraperData.scraped_text ?? "",
    competitor_urls: (() => {
      try { return run.competitor_urls ? JSON.parse(run.competitor_urls) : []; } catch { return []; }
    })(),
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
  const chiefMidMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: CHIEF_MID_PROMPT,
    messages: [{ role: "user", content: `RESEARCH.txt to review:\n\n${research}` }],
  });
  const chiefMid = chiefMidMsg.content.find((b) => b.type === "text")?.text ?? "";
  await updateRun(runId, { step_chief_mid: chiefMid, current_step: "Stage 1: Revising research (7/8)", last_updated_at: now() });

  // Step 3: Research revised
  let researchRevised = research;
  if (!chiefMid.includes("NO REVISIONS REQUIRED")) {
    const revMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: REVISE_RESEARCH_PROMPT,
      messages: [{ role: "user", content: `RESEARCH.txt (original):\n\n${research}\n\n---\n\nCHIEF_MID.txt (review):\n\n${chiefMid}` }],
    });
    researchRevised = revMsg.content.find((b) => b.type === "text")?.text ?? research;
  }
  await updateRun(runId, { step_research_revised: researchRevised, current_step: "Stage 1: Building avatar (8/8)", last_updated_at: now() });

  // Step 4a: Avatar
  const avatarMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3500,
    system: AVATAR_PROMPT,
    messages: [{ role: "user", content: `RESEARCH.txt:\n\n${researchRevised}` }],
  });
  const avatar = avatarMsg.content.find((b) => b.type === "text")?.text ?? "";
  await updateRun(runId, { step_avatar: avatar, current_step: "Stage 1: Writing offer brief", last_updated_at: now() });

  // Step 4b: Offer brief
  const offerMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3500,
    system: OFFER_BRIEF_PROMPT,
    messages: [{ role: "user", content: `RESEARCH.txt:\n\n${researchRevised}\n\n---\n\nAVATAR.txt:\n\n${avatar}` }],
  });
  const offerBrief = offerMsg.content.find((b) => b.type === "text")?.text ?? "";
  const brandName = extractBrandName(offerBrief);
  await updateRun(runId, {
    step_offer_brief: offerBrief,
    brand_name: brandName,
    current_step: "Stage 1: Identifying necessary beliefs",
    last_updated_at: now(),
  });

  // Step 4c: Necessary beliefs
  const beliefsMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3500,
    system: NECESSARY_BELIEFS_PROMPT,
    messages: [{ role: "user", content: `RESEARCH.txt:\n\n${researchRevised}\n\n---\n\nAVATAR.txt:\n\n${avatar}\n\n---\n\nOFFER_BRIEF.txt:\n\n${offerBrief}` }],
  });
  const necessaryBeliefs = beliefsMsg.content.find((b) => b.type === "text")?.text ?? "";
  await updateRun(runId, { step_necessary_beliefs: necessaryBeliefs, current_step: "Stage 1: Final chief review", last_updated_at: now() });

  // Step 5: Chief final
  const chiefFinalMsg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: CHIEF_FINAL_PROMPT,
    messages: [{
      role: "user",
      content: [
        `RESEARCH.txt (revised):\n\n${researchRevised}`,
        `\n\n---\n\nAVATAR.txt:\n\n${avatar}`,
        `\n\n---\n\nOFFER_BRIEF.txt:\n\n${offerBrief}`,
        `\n\n---\n\nNECESSARY_BELIEFS.txt:\n\n${necessaryBeliefs}`,
      ].join(""),
    }],
  });
  const chiefFinal = chiefFinalMsg.content.find((b) => b.type === "text")?.text ?? "";
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

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `PRODUCT NAME: ${productName || "(not provided — choose the best name from the research)"}\n\nRESEARCH BRIEF (Stage 1 output):\n${stage1Output}\n\nProduce the complete German copy kit now.`,
    }],
  });

  const output = msg.content.find((b) => b.type === "text")?.text ?? "";
  await updateRun(runId, { stage2_output: output, last_updated_at: now() });
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

export async function runPipeline(runId: number): Promise<void> {
  try {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");

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
  }
}

// ── Resume pipeline from last completed stage ─────────────────────────────────

export async function resumePipeline(runId: number): Promise<void> {
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
  }
}
