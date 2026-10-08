import { requireSession } from "@/lib/auth";
import { importStore } from "@/lib/import/db-store";
import { docNumbers, docSync } from "@/lib/import/doc-ops";
import { orderItems } from "@/lib/import/numbering";
import { validateRows } from "@/lib/import/validate";
import { googleDocConfigured } from "@/lib/google/docs";

export const maxDuration = 120;

// The Import list: GET the open items in work order; POST a batch of rows
// from the Import table. Doc tabs are made by the sync worker afterwards.
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

  try {
    const added = await importStore.add(items, docNumbers);
    void docSync.requestSync();
    return Response.json({ success: true, added: added.length });
  } catch (err) {
    return Response.json({ success: false, error: `Couldn't read the master doc to number them: ${err instanceof Error ? err.message : err}` }, { status: 503 });
  }
}
