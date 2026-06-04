import { redirect } from "next/navigation";

// The old static archive view (RunDetailClient) only rendered a read-only
// image grid and a "Regenerate images" link that dropped users back into the
// legacy /stage3 prompt workflow. The live run page is status-driven and
// renders every stage including the interactive Stage 3 review (pass/fail
// override, fail reasons, per-image regenerate), so always send people there.
// Kept as a redirect so any bookmarked / cached /history/[id] link still works.
export default async function HistoryRunPage({ params }: { params: Promise<unknown> }) {
  const { id } = (await params) as { id: string };
  const numericId = Number.parseInt(id, 10);
  redirect(Number.isFinite(numericId) ? `/runs/${numericId}` : "/history");
}
