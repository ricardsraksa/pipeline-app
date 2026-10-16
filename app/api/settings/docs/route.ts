import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { appAccountEmail, docIdFromLink, docSummary, extraDocIds, googleDocConfigured, setExtraDocIds } from "@/lib/google/docs";
import { masterDocId } from "@/lib/google/auth";

// The product docs: the master (from Render) plus extra docs new product
// tabs go into once a doc reaches Google's 100-tab limit (lib/google/docs.ts).
async function summaries() {
  const ids = [masterDocId(), ...(await extraDocIds())];
  return Promise.all(ids.map(async (id) => {
    try { return { ...(await docSummary(id)), error: null as string | null }; }
    catch (e) { return { id, title: null, tabs: null, error: e instanceof Error ? e.message : String(e) }; }
  }));
}

export async function GET(req: Request) {
  const denied = requireSession(req); if (denied) return denied;
  if (!googleDocConfigured()) return NextResponse.json({ configured: false, docs: [], account: null });
  return NextResponse.json({ configured: true, docs: await summaries(), account: appAccountEmail() });
}

// Body: { links: string[] } — the extra docs, oldest first. Each is opened
// before saving, so a doc the app can't reach is refused with the reason.
export async function POST(req: NextRequest) {
  const denied = requireSession(req); if (denied) return denied;
  if (!googleDocConfigured()) return NextResponse.json({ error: "Google Docs isn't connected on this server." }, { status: 503 });
  let body: { links?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const links = Array.isArray(body.links) ? body.links.filter((l): l is string => typeof l === "string" && l.trim().length > 0) : [];
  const ids: string[] = [];
  for (const l of links) {
    const id = docIdFromLink(l);
    if (!id) return NextResponse.json({ error: `Not a Google Doc link: ${l.slice(0, 80)}` }, { status: 400 });
    if (id === masterDocId() || ids.includes(id)) continue;
    try { await docSummary(id); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
    ids.push(id);
  }
  await setExtraDocIds(ids);
  return NextResponse.json({ success: true, docs: await summaries(), account: appAccountEmail() });
}
