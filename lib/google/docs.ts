// Append the Stage 2 copy kit to the EXISTING master Google Doc.
//
// Safety model: the request builder can only produce non-destructive request
// types, and an assertion enforces that immediately before batchUpdate — so
// "append can never destroy the doc" is mechanical, not aspirational. Inserts
// use endOfSegmentLocation (no index math), which cannot land inside existing
// content.

import { googleAccessToken, masterDocId, googleDocConfigured } from "./auth";
import type { Stage2Json } from "@/lib/stage2/shape";
import { whatsIncluded } from "@/lib/stage2/shape";

export { googleDocConfigured };

// The ONLY Docs request types this module may emit. deleteContentRange,
// replaceAllText, deleteTable* etc. are the destructive ones — never allowed.
const ALLOWED_REQUESTS = new Set(["insertText"]);

type DocsRequest = { insertText: { endOfSegmentLocation: { segmentId: string }; text: string } };

function assertNonDestructive(requests: Array<Record<string, unknown>>): void {
  for (const r of requests) {
    for (const k of Object.keys(r)) {
      if (!ALLOWED_REQUESTS.has(k)) throw new Error(`Refusing potentially destructive Docs request: ${k}`);
    }
  }
}

function section(label: string, value: string | undefined | null): string {
  const v = (value ?? "").trim();
  return v ? `${label}\n${v}\n\n` : "";
}

/** The copy kit as the labeled plain-text block appended to the doc. */
export function formatStage2ForDoc(productName: string, j: Stage2Json): string {
  const stamp = new Date().toISOString().slice(0, 10);
  let out = `\n${"─".repeat(40)}\n${productName || j.product_name || "Untitled product"} — ${stamp}\n${"─".repeat(40)}\n\n`;
  out += section("PRODUCT TITLE", j.product_name);
  out += section("PDP BADGE TEXT", j.badge);
  out += section("PDP TITLE SUPPORT TEXT", j.supporting_sentence);
  (j.benefits ?? []).forEach((b, i) => { out += section(`PDP BENEFIT ${i + 1}`, b); });
  out += section("WHAT'S INCLUDED (ANSWER)", whatsIncluded(j));
  (j.faqs ?? []).forEach((f, i) => {
    out += section(`PRODUCT SPECIFIC QUESTION ${i + 1}`, f?.q);
    out += section(`PRODUCT SPECIFIC ANSWER ${i + 1}`, f?.a);
  });
  (j.sections ?? []).forEach((sec, i) => {
    out += section(`SECTION ${i + 1} ${i === 0 ? "HEADING" : "HEADLINE"}`, sec?.headline);
    out += section(`SECTION ${i + 1} TEXT`, sec?.paragraph);
  });
  out += section("FACEBOOK HEADLINE", j.facebook?.headline);
  out += section("FACEBOOK PRIMARY TEXT", j.facebook?.primary);
  out += section("FACEBOOK DESCRIPTION", j.facebook?.description);
  (j.one_liners ?? []).forEach((l, i) => { out += section(`ONE-LINER ${i + 1}`, l); });
  return out;
}

export interface DocAppendResult {
  ok: boolean;
  error?: string;
}

// Single-operator concurrency guard: two Stage 2 runs finishing together
// serialize their appends instead of interleaving.
let appendChain: Promise<unknown> = Promise.resolve();

/** Append the copy kit to the master doc. Never throws. */
export async function appendStage2ToMasterDoc(productName: string, json: Stage2Json): Promise<DocAppendResult> {
  if (!googleDocConfigured()) {
    return { ok: false, error: "Google Doc export not configured — set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_MASTER_DOC_ID in Render." };
  }
  const work = appendChain.then(() => doAppend(productName, json)).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));
  appendChain = work;
  return work;
}

async function doAppend(productName: string, json: Stage2Json): Promise<DocAppendResult> {
  try {
    const token = await googleAccessToken();
    const docId = masterDocId();
    const requests: DocsRequest[] = [
      { insertText: { endOfSegmentLocation: { segmentId: "" }, text: formatStage2ForDoc(productName, json) } },
    ];
    assertNonDestructive(requests as unknown as Array<Record<string, unknown>>);

    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (res.ok) return { ok: true };

    const body = await res.text();
    // Map the failure modes to fixes the operator can actually act on.
    if (res.status === 403) {
      let saEmail = "(unknown)";
      try { saEmail = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email ?? saEmail; } catch { /* keep placeholder */ }
      return { ok: false, error: `No permission on the master doc. Share it with ${saEmail} as Editor.` };
    }
    if (res.status === 404) {
      return { ok: false, error: "Master doc not found — check GOOGLE_MASTER_DOC_ID (the id from the doc's URL)." };
    }
    if (res.status === 400 && /segment|paragraph/i.test(body)) {
      return { ok: false, error: "Docs refused the append — the doc likely ends with a table. Add an empty line after it." };
    }
    if (res.status === 400 && /size|limit/i.test(body)) {
      return { ok: false, error: "The master doc is full (Docs size limit). Start a new master doc and update GOOGLE_MASTER_DOC_ID." };
    }
    return { ok: false, error: `Docs API ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-doc]", message);
    return { ok: false, error: message };
  }
}
