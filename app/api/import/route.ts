import { requireSession } from "@/lib/auth";
import { importStore } from "@/lib/import/db-store";
import { currentBase, docSync } from "@/lib/import/doc-ops";
import { orderItems } from "@/lib/import/numbering";
import { validateRows } from "@/lib/import/validate";
import { googleDocConfigured } from "@/lib/google/docs";

export const maxDuration = 120;

// The Import list: GET the open items in work order; POST a batch of rows
// from the Import table. New items get their doc tabs after the response.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const items = orderItems(await importStore.listOpen());
  return Response.json({ items, docConfigured: googleDocConfigured() });
}

export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { rows?: unknown };
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 100) : [];
  const { items, errors } = validateRows(rows);
  if (errors.length) return Response.json({ success: false, errors }, { status: 400 });
  if (!items.length) return Response.json({ success: false, error: "Nothing to import" }, { status: 400 });

  const added = await importStore.add(items, await currentBase());
  // Every open item may have shifted (priority rows go first), so sync all.
  void importStore.listOpen().then((open) => docSync.syncItems(orderItems(open)));
  return Response.json({ success: true, added: added.length });
}
