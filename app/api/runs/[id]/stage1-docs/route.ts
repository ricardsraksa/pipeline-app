import { getRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// Download the Stage 1 foundational documents as one markdown file:
// research, avatar, offer brief, necessary beliefs, the chief's review, and
// the one-pager. Revised versions win over originals (the revised doc is what
// the rest of the pipeline actually ran on); the original is kept below it
// when both exist, so the download is a complete record.
export async function GET(
  req: Request,
  context: { params: Promise<unknown> },
) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { id } = (await context.params) as { id: string };
  const runId = Number(id);
  if (!Number.isFinite(runId)) return new Response("bad run id", { status: 400 });

  const run = await getRun(runId);
  if (!run) return new Response("Run not found", { status: 404 });

  const name = (run.brand_name ?? run.product_name ?? `run-${runId}`).trim();
  const code = run.product_code?.trim();
  const stamp = (run.completed_at ?? run.created_at ?? new Date().toISOString()).slice(0, 10);

  const parts: string[] = [
    `# ${code ? code + " — " : ""}${name} — Stage 1 foundational documents`,
    "",
    `Run #${runId} · ${stamp}`,
    run.product_url ? `\nProduct URL: ${run.product_url}` : "",
    "",
  ];

  const section = (title: string, body: string | null | undefined, note?: string) => {
    const text = (body ?? "").trim();
    if (!text) return;
    parts.push("\n---\n", `## ${title}${note ? ` ${note}` : ""}`, "", text, "");
  };

  // One-pager first — it's the document the later stages consume.
  section("One-pager", run.stage1_one_pager_edited ?? run.stage1_one_pager,
    run.stage1_one_pager_edited ? "(edited)" : undefined);
  section("Customer avatar", run.step_avatar_revised ?? run.step_avatar,
    run.step_avatar_revised ? "(revised)" : undefined);
  section("Offer brief", run.step_offer_brief_revised ?? run.step_offer_brief,
    run.step_offer_brief_revised ? "(revised)" : undefined);
  section("Necessary beliefs", run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs,
    run.step_necessary_beliefs_revised ? "(revised)" : undefined);
  section("Chief marketing review", run.step_chief_final);
  section("Product research", run.step_research_revised ?? run.step_research,
    run.step_research_revised ? "(revised)" : undefined);

  // Keep the pre-revision originals at the end when a revision replaced them.
  if (run.step_avatar_revised) section("Appendix — original customer avatar", run.step_avatar);
  if (run.step_offer_brief_revised) section("Appendix — original offer brief", run.step_offer_brief);
  if (run.step_necessary_beliefs_revised) section("Appendix — original necessary beliefs", run.step_necessary_beliefs);

  const body = parts.filter((p) => p !== "").join("\n");
  const slug = `${code ? code + "-" : ""}${name}`
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `run-${runId}`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-stage1.md"`,
      "Cache-Control": "no-store",
    },
  });
}
