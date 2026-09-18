import { requireSession } from "@/lib/auth";
import { getRun } from "@/lib/db";
import { ensureAudience } from "@/lib/audience";

// Work out who a product is for on a run whose research predates the explicit
// decision (the card's "Work it out"). Stored as "derived" and editable.
export const maxDuration = 120;

export async function POST(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const run = await getRun(parseInt(id, 10));
  if (!run) return Response.json({ success: false, error: "Run not found" }, { status: 404 });
  const audience = await ensureAudience(run);
  if (!audience) return Response.json({ success: false, error: "Not enough research on this run to work it out" }, { status: 400 });
  return Response.json({ success: true, audience });
}
