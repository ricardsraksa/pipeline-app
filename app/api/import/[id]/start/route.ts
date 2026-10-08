import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
import { createRun } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline-runner";
import { importStore } from "@/lib/import/db-store";
import { currentBase, docSync } from "@/lib/import/doc-ops";
import { codeForStart } from "@/lib/import/numbering";
import { splitLinks } from "@/lib/import/links";

export const maxDuration = 30;

// Start a run from an Import item: the operator pasted the AliExpress link.
// The run takes the next number (whichever row it was); Instagram links ride
// along as references, every other link is a competitor page.
export async function POST(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const itemId = Number(id);
  const item = Number.isInteger(itemId) ? await importStore.get(itemId) : null;
  if (!item) return Response.json({ success: false, error: "Import item not found" }, { status: 404 });
  if (item.runId) return Response.json({ success: false, error: "Already started", runId: item.runId }, { status: 409 });

  const { productUrl } = (await req.json().catch(() => ({}))) as { productUrl?: string };
  const url = (productUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return Response.json({ success: false, error: "Paste the full AliExpress link (https://…)" }, { status: 400 });
  }
  try { await assertPublicUrl(url); } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : "Blocked URL" }, { status: 400 });
  }

  const base = await currentBase();
  const code = codeForStart(base);
  const { references, competitors } = splitLinks(item.urls);
  const runId = await createRun({
    product_url: url,
    product_name: item.name,
    product_description: "",
    competitor_urls: competitors,
    reference_urls: references,
    priority: item.priority,
    product_code: code,
    status: "pending",
  });
  const changed = await importStore.markStarted(itemId, runId, code, base + 1);
  revalidatePath("/");
  runPipeline(runId).catch((err) => console.error(`Pipeline ${runId} failed:`, err));
  void docSync.syncItems(changed);
  return Response.json({ success: true, runId, code });
}
