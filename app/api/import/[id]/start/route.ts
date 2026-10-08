import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
import { createRun } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline-runner";
import { importStore } from "@/lib/import/db-store";
import { docNumbers, docSync } from "@/lib/import/doc-ops";
import { splitLinks } from "@/lib/import/links";

export const maxDuration = 30;

// Start a run from an Import item: the operator pasted the AliExpress link.
// The store claims the item, gives it the next number (whichever row it was)
// and creates the run in one queued step. Instagram links ride along as
// references; every other link is a competitor page.
export async function POST(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { id } = (await context.params) as { id: string };
  const itemId = Number(id);
  if (!Number.isInteger(itemId)) return Response.json({ success: false, error: "Import item not found" }, { status: 404 });

  const { productUrl } = (await req.json().catch(() => ({}))) as { productUrl?: string };
  const url = (productUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return Response.json({ success: false, error: "Paste the full AliExpress link (https://…)" }, { status: 400 });
  }
  try { await assertPublicUrl(url); } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : "Blocked URL" }, { status: 400 });
  }

  let started: { runId: number; code: string };
  try {
    started = await importStore.start(itemId, docNumbers, async (code, item) => {
      const { references, competitors } = splitLinks(item.urls);
      return createRun({
        product_url: url,
        product_name: item.name,
        product_description: "",
        competitor_urls: competitors,
        reference_urls: references,
        priority: item.priority,
        product_code: code,
        status: "pending",
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /already started/i.test(msg) ? 409 : /not found/i.test(msg) ? 404 : 503;
    return Response.json({ success: false, error: status === 503 ? `Not started: ${msg}` : msg }, { status });
  }

  revalidatePath("/runs");
  runPipeline(started.runId).catch((err) => console.error(`Pipeline ${started.runId} failed:`, err));
  void docSync.requestSync();
  return Response.json({ success: true, runId: started.runId, code: started.code });
}
