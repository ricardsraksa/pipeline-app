// Feedback-loop helpers. Each builder pulls recent thumbs + notes from past
// runs of the given stage and formats them as a "FEEDBACK FROM PAST RUNS" block
// for injection into that stage's system prompt — so the user's 👍/👎 + free-
// text comment actually steers the next generation.
//
// Source of truth is the `feedback_notes` table (durable; survives run delete).
// On first read we also backfill from the legacy `runs.feedback_stage{N}*`
// columns for any rows that haven't been mirrored yet — one-shot, idempotent.

import { db } from "./db";

const RECENT_LIMIT = 5;

interface FeedbackRow {
  product_name: string | null;
  brand_name: string | null;
  vote: string | null;
  note: string | null;
}

let backfilled = false;

async function backfillOnce(): Promise<void> {
  if (backfilled) return;
  backfilled = true;
  try {
    for (const stage of [1, 2, 3] as const) {
      const voteCol = `feedback_stage${stage}`;
      const noteCol = `feedback_stage${stage}_note`;
      // Pick runs that have a vote OR note but no matching feedback_notes row.
      await db.execute(`
        INSERT OR IGNORE INTO feedback_notes
          (source_run_id, stage, vote, note, product_name, brand_name, created_at, updated_at)
        SELECT
          r.id, ${stage}, r.${voteCol}, r.${noteCol},
          r.product_name, r.brand_name,
          COALESCE(r.last_updated_at, r.created_at),
          COALESCE(r.last_updated_at, r.created_at)
        FROM runs r
        WHERE (r.${voteCol} IS NOT NULL AND r.${voteCol} != '')
           OR (r.${noteCol} IS NOT NULL AND r.${noteCol} != '')
      `);
    }
  } catch (err) {
    console.error("[feedback] backfill failed:", err);
  }
}

async function recent(stage: 1 | 2 | 3): Promise<FeedbackRow[]> {
  await backfillOnce();
  const result = await db.execute(
    `SELECT product_name, brand_name, vote, note
       FROM feedback_notes
      WHERE stage = ?
        AND ( (vote IS NOT NULL AND vote != '')
           OR (note IS NOT NULL AND note != '') )
      ORDER BY updated_at DESC
      LIMIT ${RECENT_LIMIT}`,
    [stage],
  );
  return result.rows as unknown as FeedbackRow[];
}

function format(rows: FeedbackRow[]): string {
  return rows
    .map((r) => {
      const name = (r.brand_name ?? r.product_name ?? "previous run").trim();
      const verdict = r.vote === "up" ? "👍 worked well" : r.vote === "down" ? "👎 did NOT work" : "(no vote)";
      const note = r.note?.trim();
      const noteSegment = note ? ` — user note: "${note}"` : "";
      return `- ${name}: ${verdict}${noteSegment}`;
    })
    .join("\n");
}

async function build(stage: 1 | 2 | 3, label: string): Promise<string> {
  try {
    const rows = await recent(stage);
    if (!rows.length) return "";
    return `\n\n--- ${label} ---\n${format(rows)}\n---`;
  } catch {
    // DB hiccup must not break the pipeline.
    return "";
  }
}

/** For the Stage 1 one-pager synthesis. */
export function buildStage1FeedbackBlock(): Promise<string> {
  return build(
    1,
    "FEEDBACK FROM PAST STAGE-1 RESEARCH (👍 = good angle/depth, 👎 = miss; use notes to adjust focus)",
  );
}

/** For the Stage 2 German copy generation. */
export function buildStage2FeedbackBlock(): Promise<string> {
  return build(
    2,
    "FEEDBACK FROM PAST STAGE-2 COPY (👍 = copy that landed, 👎 = avoid; use notes to adjust tone/angle)",
  );
}

/** For the Stage 3 image-prompts generation. */
export function buildStage3FeedbackBlock(): Promise<string> {
  return build(
    3,
    "FEEDBACK FROM PAST STAGE-3 IMAGES (👍 = visuals that landed, 👎 = avoid; use notes to adjust style/composition)",
  );
}
