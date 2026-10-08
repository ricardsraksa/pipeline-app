import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { assertPublicUrl } from "@/lib/ssrf";
import { createRun } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline-runner";
import { importStore } from "@/lib/import/db-store";
import { docNumbers, docSync } from "@/lib/import/doc-ops";
import { splitLinks } from "@/lib/import/links";
import { validateRows } from "@/lib/import/validate";

export const maxDuration = 30;

// New run from the Runs page: one product, started at once. It goes through
// the Import store (add, then start) so it gets the next number and a tab
// like every other product.
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; links?: unknown; priority?: unknown; productUrl?: unknown };

  const url = typeof b.productUrl === "string" ? b.productUrl.trim() : "";
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return Response.json({ success: false, error: "AliExpress link isn't a full link" }, { status: 400 });
  }
  try { await assertPublicUrl(url); } catch (e) {
    return Response.json({ success: false, error: e instanceof Error ? e.message : "Blocked URL" }, { status: 400 });
  }
  const { items, errors } = validateRows([{ name: b.name, links: typeof b.links === "string" ? b.links : "", priority: b.priority }], { linksOptional: true });
  if (errors.length || !items.length) return Response.json({ success: false, error: errors[0]?.message ?? "Add a product name" }, { status: 400 });

  let started: { runId: number; code: string };
  try {
    const [item] = await importStore.add(items, docNumbers);
    started = await importStore.start(item.id, docNumbers, async (code, it) => {
      const { references, competitors } = splitLinks(it.urls);
      return createRun({
        product_url: url,
        product_name: it.name,
        product_description: "",
        competitor_urls: competitors,
        reference_urls: references,
        priority: it.priority,
        product_code: code,
        status: "pending",
      });
    });
  } catch (err) {
    return Response.json({ success: false, error: `Not started: ${err instanceof Error ? err.message : err}` }, { status: 503 });
  }

  revalidatePath("/runs");
  runPipeline(started.runId).catch((err) => console.error(`Pipeline ${started.runId} failed:`, err));
  void docSync.requestSync();
  return Response.json({ success: true, runId: started.runId, code: started.code });
}
