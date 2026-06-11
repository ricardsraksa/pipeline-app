import { NextRequest, NextResponse } from "next/server";
import { MODEL_CATALOG, getAllModelSelections, setModel, isKnownRole } from "@/lib/models";

// Read the model catalog + current per-role selections for the Settings UI.
export async function GET() {
  const selections = await getAllModelSelections();
  return NextResponse.json({ catalog: MODEL_CATALOG, selections });
}

// Save one or more role → model selections. Body: { selections: { role: modelId } }.
export async function POST(req: NextRequest) {
  let body: { selections?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sel = body.selections;
  if (!sel || typeof sel !== "object") {
    return NextResponse.json({ error: "selections object required" }, { status: 400 });
  }

  const entries = Object.entries(sel);
  for (const [role] of entries) {
    if (!isKnownRole(role)) {
      return NextResponse.json({ error: `Unknown role: ${role}` }, { status: 400 });
    }
  }
  try {
    for (const [role, modelId] of entries) {
      if (isKnownRole(role)) await setModel(role, modelId);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed" }, { status: 400 });
  }

  return NextResponse.json({ success: true, selections: await getAllModelSelections() });
}
