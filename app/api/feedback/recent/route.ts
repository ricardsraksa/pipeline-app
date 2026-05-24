import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/feedback/recent?stage=1|2|3 — returns the last 5 rated runs for the
 * given stage, mirroring the rows that lib/feedback.ts injects into the next
 * generation's system prompt. Used by the UI to show "what's being applied."
 */
export async function GET(req: NextRequest) {
  const stage = req.nextUrl.searchParams.get("stage");
  if (!["1", "2", "3"].includes(stage ?? "")) {
    return Response.json({ error: "stage must be 1, 2 or 3" }, { status: 400 });
  }
  const voteCol = `feedback_stage${stage}`;
  const noteCol = `feedback_stage${stage}_note`;
  try {
    const result = await db.execute(
      `SELECT id, product_name, brand_name, ${voteCol} AS vote, ${noteCol} AS note, created_at
         FROM runs
        WHERE (${voteCol} IS NOT NULL AND ${voteCol} != '')
           OR (${noteCol} IS NOT NULL AND ${noteCol} != '')
        ORDER BY created_at DESC
        LIMIT 5`,
    );
    return Response.json({ items: result.rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg, items: [] }, { status: 500 });
  }
}
