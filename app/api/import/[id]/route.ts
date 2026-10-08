import { requireSession } from "@/lib/auth";
import { importStore } from "@/lib/import/db-store";
import { docNumbers, docSync } from "@/lib/import/doc-ops";
import { validateRows } from "@/lib/import/validate";

// Edit an open Import item: name, links, priority. The sync worker renames
// any tabs whose number moved.
export async function PATCH(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const itemId = Number(id);
  const item = Number.isInteger(itemId) ? await importStore.get(itemId) : null;
  if (!item || item.runId) return Response.json({ success: false, error: "Not an open Import item" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { name?: unknown; links?: unknown; priority?: unknown };
  const priority = typeof b.priority === "boolean" ? b.priority : item.priority;
  // A priority toggle alone never fails on the links (an adopted tab may have none).
  if (typeof b.name !== "string" && typeof b.links !== "string") {
    try {
      await importStore.update(itemId, { priority }, docNumbers);
    } catch (err) {
      return Response.json({ success: false, error: `Couldn't read the master doc: ${err instanceof Error ? err.message : err}` }, { status: 503 });
    }
    void docSync.requestSync();
    return Response.json({ success: true });
  }
  const { items, errors } = validateRows([{
    name: typeof b.name === "string" ? b.name : item.name,
    links: typeof b.links === "string" ? b.links : item.urls.join("\n"),
    priority,
  }]);
  if (errors.length || !items.length) return Response.json({ success: false, error: errors[0]?.message ?? "Invalid" }, { status: 400 });

  try {
    await importStore.update(itemId, items[0], docNumbers);
  } catch (err) {
    return Response.json({ success: false, error: `Couldn't read the master doc: ${err instanceof Error ? err.message : err}` }, { status: 503 });
  }
  void docSync.requestSync();
  return Response.json({ success: true });
}
