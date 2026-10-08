import { requireSession } from "@/lib/auth";
import { importStore } from "@/lib/import/db-store";
import { currentBase, docSync } from "@/lib/import/doc-ops";
import { validateRows } from "@/lib/import/validate";

// Edit an open Import item: name, links, priority. Renames tabs that moved.
export async function PATCH(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const itemId = Number(id);
  const item = Number.isInteger(itemId) ? await importStore.get(itemId) : null;
  if (!item || item.runId) return Response.json({ success: false, error: "Not an open Import item" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { name?: unknown; links?: unknown; priority?: unknown };
  const { items, errors } = validateRows([{
    name: typeof b.name === "string" ? b.name : item.name,
    links: typeof b.links === "string" ? b.links : item.urls.join("\n"),
    priority: typeof b.priority === "boolean" ? b.priority : item.priority,
  }]);
  if (errors.length || !items.length) return Response.json({ success: false, error: errors[0]?.message ?? "Invalid" }, { status: 400 });

  const changed = await importStore.update(itemId, items[0], await currentBase());
  void docSync.syncItems(changed);
  return Response.json({ success: true });
}
