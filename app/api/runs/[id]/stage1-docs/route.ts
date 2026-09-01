import { getRun } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// Download the Stage 1 FOUNDATIONAL documents as one markdown file — the
// material an ad writer works from: customer avatar, offer brief, necessary
// beliefs, and the one-pager. Deliberately excludes the process artifacts
// (the chief's internal review, the raw research dump, pre-revision
// originals) — those are audit trail, not ad source material. Revised
// versions win: they are what the rest of the pipeline ran on.
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

  // One-pager first — the condensed brief later stages consume.
  section("One-pager", run.stage1_one_pager_edited ?? run.stage1_one_pager,
    run.stage1_one_pager_edited ? "(edited)" : undefined);
  section("Customer avatar", run.step_avatar_revised ?? run.step_avatar,
    run.step_avatar_revised ? "(revised)" : undefined);
  section("Offer brief", run.step_offer_brief_revised ?? run.step_offer_brief,
    run.step_offer_brief_revised ? "(revised)" : undefined);
  section("Necessary beliefs", run.step_necessary_beliefs_revised ?? run.step_necessary_beliefs,
    run.step_necessary_beliefs_revised ? "(revised)" : undefined);

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
