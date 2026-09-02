import { NextRequest } from "next/server";
import { db } from "@/lib/db";

import { requireSession } from "@/lib/auth";
/**
 * GET /api/feedback/recent?stage=1|2|3 — returns the last 5 rated entries for
 * the given stage, mirroring the rows lib/feedback.ts injects into the next
 * generation's system prompt. Reads from the durable feedback_notes table so
 * notes from deleted runs are still surfaced ("Applied N past feedback").
 */
export async function GET(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const stage = req.nextUrl.searchParams.get("stage");
  if (!["1", "2", "3"].includes(stage ?? "")) {
    return Response.json({ error: "stage must be 1, 2 or 3" }, { status: 400 });
  }
  try {
    const result = await db.execute({
      sql: `SELECT
              COALESCE(source_run_id, -id) AS id,
              product_name, brand_name, vote, note,
              updated_at AS created_at
            FROM feedback_notes
            WHERE stage = ?
              AND ( (vote IS NOT NULL AND vote != '')
                 OR (note IS NOT NULL AND note != '') )
            ORDER BY updated_at DESC
            LIMIT 5`,
      args: [Number(stage)],
    });
    return Response.json({ items: result.rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg, items: [] }, { status: 500 });
  }
}
