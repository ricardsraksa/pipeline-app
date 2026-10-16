// Fill a product's tab in the master Google Doc.
//
// The master doc has one TAB per product (duplicated by the operator from the
// template tab, titled "P58 - Anti Theft ..."), each containing the template
// tables: SHOPIFY COPYWRITING (BADGE TEXT, SUPPORTING SENTENCE, BENEFIT
// SECTION, FAQ cells, SECTION 1-3), FACEBOOK COPYWRITING (Headline, Primary
// Text, Description) and AD COPYWRITING (ONE LINERS). This module finds the
// tab by the run's product code, locates each label row, and inserts the
// copy into the empty cell of the row below it.
//
// Safety model:
//   - Only insertText, addDocumentTab and updateDocumentTabProperties can
//     leave this module (lib/google/guard.ts) — asserted immediately before
//     every batchUpdate. Nothing can delete or overwrite content.
//   - Cells that already have content are SKIPPED and reported, never
//     overwritten — re-running fills gaps only.
//   - The write targets one explicit tabId; without a matched tab, nothing
//     is written anywhere (requests without tabId would hit the first tab).

import { googleAccessToken, masterDocId, googleDocConfigured } from "./auth";
import type { Stage2Json } from "@/lib/stage2/shape";
import { whatsIncluded } from "@/lib/stage2/shape";
import { codeNumber, sameCode } from "@/lib/import/codes";
import { assertNonDestructive } from "./guard";
import { getKV, setKV } from "@/lib/db";

export { googleDocConfigured };


// ── Docs document JSON (minimal shapes we read) ─────────────────────────────

interface TextRun { textRun?: { content?: string } }
interface Paragraph { elements?: TextRun[] }
interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  table?: { tableRows?: TableRow[] };
}
interface TableRow { tableCells?: TableCell[] }
interface TableCell { content?: StructuralElement[] }
interface Tab {
  tabProperties?: { tabId?: string; title?: string };
  documentTab?: { body?: { content?: StructuralElement[] } };
  childTabs?: Tab[];
}

function paragraphText(p?: Paragraph): string {
  return (p?.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
}

function cellText(cell: TableCell): string {
  return (cell.content ?? []).map((el) => paragraphText(el.paragraph)).join("");
}

/** Insertion index for an empty-ish cell: the start of its first paragraph. */
function cellInsertIndex(cell: TableCell): number | null {
  const first = (cell.content ?? []).find((el) => el.paragraph && typeof el.startIndex === "number");
  return first?.startIndex ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function flattenTabs(tabs: Tab[]): Tab[] {
  const out: Tab[] = [];
  for (const t of tabs) {
    out.push(t);
    if (t.childTabs?.length) out.push(...flattenTabs(t.childTabs));
  }
  return out;
}

// ── Label → value mapping (labels as they appear in the template tables) ────

function valuesForLabels(j: Stage2Json): Array<{ match: string; value: string }> {
  // Blank line between parts — benefits, Q↔A, headline↔paragraph, one-liners —
  // matching how the operator formats these cells by hand.
  const joined = (parts: Array<string | undefined>) => parts.filter((x) => x?.trim()).join("\n\n");
  const sec = (i: number) => j.sections[i] ?? { headline: "", paragraph: "" };
  const faqPair = (i: number) => joined([j.faqs[i]?.q, j.faqs[i]?.a]);
  return [
    { match: "badgetext", value: j.badge ?? "" },
    { match: "supportingsentence", value: j.supporting_sentence ?? "" },
    { match: "benefitsection", value: joined(j.benefits ?? []) },
    { match: "faqwhatsincludedanswer", value: whatsIncluded(j) },
    { match: "faqcustomquestion1", value: faqPair(0) },
    { match: "faqcustomquestion2", value: faqPair(1) },
    { match: "section1", value: joined([sec(0).headline, sec(0).paragraph]) },
    { match: "section2", value: joined([sec(1).headline, sec(1).paragraph]) },
    { match: "section3", value: joined([sec(2).headline, sec(2).paragraph]) },
    { match: "headline", value: j.facebook?.headline ?? "" },
    { match: "primarytext", value: j.facebook?.primary ?? "" },
    { match: "description", value: j.facebook?.description ?? "" },
    { match: "oneliners", value: (j.one_liners ?? []).filter((o) => o?.trim()).join("\n\n") },
  ];
}

// ── More than one product doc ───────────────────────────────────────────────
// Google caps a doc at 100 tabs and the master doc is full, so new products
// get their tab in an extra doc (Settings). Everything reads every doc; new
// tabs go into the last doc. A tab in an extra doc is identified as
// "<docId>::<tabId>"; master-doc tabs keep their plain id, so every id saved
// before this still works.

const EXTRA_DOCS_KEY = "gdoc_extra_docs";
const SEP = "::";

/** The extra docs' ids, oldest first. */
export async function extraDocIds(): Promise<string[]> {
  try {
    const v = JSON.parse((await getKV(EXTRA_DOCS_KEY)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 10) : [];
  } catch { return []; }
}
export async function setExtraDocIds(ids: string[]): Promise<void> {
  await setKV(EXTRA_DOCS_KEY, JSON.stringify(ids));
}
/** Every product doc: the master first, then the extras. */
export async function docIds(): Promise<string[]> {
  return [masterDocId(), ...(await extraDocIds()).filter((id) => id !== masterDocId())];
}
function joinTab(docId: string, tabId: string): string {
  return docId === masterDocId() ? tabId : `${docId}${SEP}${tabId}`;
}
/** Which doc a stored tab id lives in, and its id inside that doc. */
export function splitTab(id: string): { docId: string; tabId: string } {
  const i = id.indexOf(SEP);
  return i > 0 ? { docId: id.slice(0, i), tabId: id.slice(i + SEP.length) } : { docId: masterDocId(), tabId: id };
}

async function readDoc(docId: string, fields?: string): Promise<{ tabs?: Tab[]; title?: string }> {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}?includeTabsContent=true${fields ? `&fields=${encodeURIComponent(fields)}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 403) {
    let saEmail = "(unknown)";
    try { saEmail = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email ?? saEmail; } catch { /* keep */ }
    throw new Error(`No permission on doc ${docId}. Share it with ${saEmail} as Editor.`);
  }
  if (res.status === 404) throw new Error(`Doc ${docId} not found.`);
  if (!res.ok) throw new Error(`Docs API ${res.status} while reading tabs.`);
  return (await res.json()) as { tabs?: Tab[]; title?: string };
}

/** Rewrite a doc's tab ids to the stored form ("<docId>::<tabId>" outside the master). */
function withDocIds(docId: string, tabs: Tab[]): Tab[] {
  const walk = (list: Tab[]): Tab[] => list.map((t) => ({
    ...t,
    tabProperties: t.tabProperties?.tabId ? { ...t.tabProperties, tabId: joinTab(docId, t.tabProperties.tabId) } : t.tabProperties,
    childTabs: t.childTabs ? walk(t.childTabs) : t.childTabs,
  }));
  return walk(tabs);
}

/** Every product doc's tabs, flattened, with stored-form ids. Throws with
 *  operator-readable messages on auth/id problems. */
export async function fetchDocTabs(): Promise<Tab[]> {
  const out: Tab[] = [];
  for (const id of await docIds()) out.push(...flattenTabs(withDocIds(id, (await readDoc(id)).tabs ?? [])));
  return out;
}

/** A doc's title and tab count; throws when the app can't open it. */
export async function docSummary(docId: string): Promise<{ id: string; title: string; tabs: number }> {
  const fields = "title,tabs(tabProperties(tabId),childTabs(tabProperties(tabId),childTabs(tabProperties(tabId),childTabs(tabProperties(tabId)))))";
  const doc = await readDoc(docId, fields);
  return { id: docId, title: doc.title ?? "(untitled)", tabs: flattenTabs(doc.tabs ?? []).length };
}

/** "https://docs.google.com/document/d/<id>/edit…" or a bare id → the id. */
export function docIdFromLink(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/\/document\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

/** The account the docs must be shared with (as Editor). */
export function appAccountEmail(): string | null {
  try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email ?? null; } catch { return null; }
}

/** The doc tab title for a product code ("P55 - Wall Lamp"), or null. Never throws.
 *  A run started from Import knows its exact tab (`tabId`), which wins. */
export async function docTabTitleForCode(code: string, tabId?: string | null): Promise<string | null> {
  if (!googleDocConfigured() || (!code.trim() && !tabId)) return null;
  try {
    const tabs = await fetchDocTabs();
    const tab = (tabId && tabs.find((t) => t.tabProperties?.tabId === tabId)) || findProductTab(tabs, code);
    return tab?.tabProperties?.title ?? null;
  } catch {
    return null;
  }
}

/** The tab whose title carries the product code, ignoring a leading 💦 or
 *  other emoji ("💦 P93 - Mug" matches "P93"). */
export function findProductTab(tabs: Tab[], code: string): Tab | undefined {
  return tabs.find((t) => sameCode(t.tabProperties?.title ?? "", code));
}

/** Pure fill planner: walk the tab's tables, match label rows, target the
 *  empty cell in the row below each. Exported for unit tests. */
export function planFills(tab: Tab, json: Stage2Json): { rows: FillRow[]; inserts: Array<{ index: number; text: string }> } {
  const wanted = valuesForLabels(json);
  const rows: FillRow[] = [];
  const inserts: Array<{ index: number; text: string }> = [];
  const seen = new Set<string>();

  for (const el of tab.documentTab?.body?.content ?? []) {
    const tableRows = el.table?.tableRows ?? [];
    for (let r = 0; r < tableRows.length - 1; r++) {
      const labelCells = tableRows[r].tableCells ?? [];
      if (!labelCells.length) continue;
      const label = norm(cellText(labelCells[0]));
      const target = wanted.find((w) => w.match === label);
      if (!target || seen.has(target.match)) continue;
      seen.add(target.match);

      if (!target.value.trim()) { rows.push({ label: target.match, status: "empty-value" }); continue; }
      // The value's home is the RIGHT column of the row below the label
      // (falling back to the only cell when the row has a single column).
      const valueRowCells = tableRows[r + 1].tableCells ?? [];
      const valueCell = valueRowCells[1] ?? valueRowCells[0];
      if (!valueCell) { rows.push({ label: target.match, status: "label-not-found" }); continue; }
      if (cellText(valueCell).trim()) { rows.push({ label: target.match, status: "already-filled" }); continue; }
      const idx = cellInsertIndex(valueCell);
      if (idx === null) { rows.push({ label: target.match, status: "label-not-found" }); continue; }
      inserts.push({ index: idx, text: target.value });
      rows.push({ label: target.match, status: "filled" });
    }
  }
  for (const w of wanted) {
    if (!seen.has(w.match)) rows.push({ label: w.match, status: "label-not-found" });
  }
  return { rows, inserts };
}

/** Overview lines the pipeline can fill: bare "Label:" paragraphs above the
 *  tables. Only writes when nothing follows the colon — a typed value is
 *  never touched. Exported for unit tests. */
export function planOverviewFills(
  tab: Tab,
  info: { productName?: string; productUrl?: string; competitorUrl?: string },
): { rows: FillRow[]; inserts: Array<{ index: number; text: string }> } {
  const targets: Array<{ re: RegExp; label: string; value: string | undefined }> = [
    { re: /^product name\s*:\s*$/i, label: "overview: product name", value: info.productName },
    { re: /^alibaba link\s*:\s*$/i, label: "overview: alibaba link", value: info.productUrl },
    { re: /^competitor\s*\/?\s*example link\s*:\s*$/i, label: "overview: competitor link", value: info.competitorUrl },
  ];
  const rows: FillRow[] = [];
  const inserts: Array<{ index: number; text: string }> = [];
  const seen = new Set<string>();

  for (const el of tab.documentTab?.body?.content ?? []) {
    if (!el.paragraph || typeof el.endIndex !== "number") continue;
    const text = paragraphText(el.paragraph).replace(/\n/g, "").trim();
    for (const t of targets) {
      if (seen.has(t.label)) continue;
      // Bare label line → fill. A line with content after the colon doesn't
      // match the regex, so it's reported occupied below.
      if (t.re.test(text)) {
        seen.add(t.label);
        if (!t.value?.trim()) { rows.push({ label: t.label, status: "empty-value" }); break; }
        // endIndex is past the trailing newline — insert just before it.
        inserts.push({ index: el.endIndex - 1, text: " " + t.value.trim() });
        rows.push({ label: t.label, status: "filled" });
        break;
      }
      // Same label but with a value already present.
      const bare = t.re.source.replace("\\s*:\\s*$", "");
      if (new RegExp("^" + bare + "\\s*:\\s*\\S", "i").test(text)) {
        seen.add(t.label);
        rows.push({ label: t.label, status: "already-filled" });
        break;
      }
    }
  }
  return { rows, inserts };
}

// ── The fill ────────────────────────────────────────────────────────────────

export interface FillRow {
  label: string;
  status: "filled" | "already-filled" | "empty-value" | "label-not-found";
}

export interface FillResult {
  ok: boolean;
  error?: string;
  tabTitle?: string;
  dryRun?: boolean;
  rows?: FillRow[];
  availableTabs?: string[];
}

export async function fillProductTab(params: {
  productCode: string;
  /** The run's own tab (runs started from Import) — used before the code. */
  tabId?: string | null;
  json: Stage2Json;
  /** Overview block values (bare "Label:" lines above the tables). */
  overview?: { productName?: string; productUrl?: string; competitorUrl?: string };
  dryRun?: boolean;
}): Promise<FillResult> {
  if (!googleDocConfigured()) {
    return { ok: false, error: "Google Doc export not configured — set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_MASTER_DOC_ID in Render." };
  }
  const code = params.productCode?.trim();
  if (!code) {
    return { ok: false, error: "Set a Product code on this run first (e.g. P58) — it selects which tab of the master doc to fill." };
  }

  try {
    const token = await googleAccessToken();
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    // Every product doc: the product's tab may be in the master or an extra doc.
    const tabs = await fetchDocTabs();

    // The run's own tab when it has one, else the tab titled "P58 - ...".
    const tab = (params.tabId && tabs.find((t) => t.tabProperties?.tabId === params.tabId)) || findProductTab(tabs, code);
    if (!tab || !tab.tabProperties?.tabId) {
      return {
        ok: false,
        error: `No tab starting with “${code}” in the master doc. Duplicate the template tab and name it “${code} - <product>”, then send again.`,
        availableTabs: tabs.map((t) => t.tabProperties?.title ?? "?").slice(0, 60),
      };
    }
    const { docId, tabId } = splitTab(tab.tabProperties.tabId);
    const tabTitle = tab.tabProperties.title ?? code;

    // Pure planning step (unit-tested against a replica of the template).
    const tablePlan = planFills(tab, params.json);
    const overviewPlan = planOverviewFills(tab, params.overview ?? {});
    const rows = [...overviewPlan.rows, ...tablePlan.rows];
    const inserts = [...tablePlan.inserts, ...overviewPlan.inserts];

    if (params.dryRun) return { ok: true, dryRun: true, tabTitle, rows };

    if (inserts.length) {
      // DESCENDING index order: each insert shifts everything after it, so
      // writing back-to-front keeps every remaining index valid.
      inserts.sort((a, b) => b.index - a.index);
      const requests = inserts.map((i) => ({
        insertText: { location: { index: i.index, tabId }, text: i.text },
      }));
      assertNonDestructive(requests as unknown as Array<Record<string, unknown>>);
      const upRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        { method: "POST", headers: auth, body: JSON.stringify({ requests }) },
      );
      if (!upRes.ok) {
        const body = await upRes.text();
        return { ok: false, tabTitle, error: `Docs API ${upRes.status}: ${body.slice(0, 200)}` };
      }
    }
    return { ok: true, tabTitle, rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-doc]", message);
    return { ok: false, error: message };
  }
}

// ── Import list: create / rename / list product tabs ────────────────────────

async function batchUpdate(docId: string, requests: Array<Record<string, unknown>>): Promise<{ replies?: Array<Record<string, unknown>> }> {
  assertNonDestructive(requests);
  const token = await googleAccessToken();
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests }) },
  );
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { replies?: Array<Record<string, unknown>> };
}

/** Rename one tab (the 💦 mark and the P number live in the title). */
export async function renameTab(id: string, title: string): Promise<void> {
  const { docId, tabId } = splitTab(id);
  await batchUpdate(docId, [{ updateDocumentTabProperties: { tabProperties: { tabId, title }, fields: "title" } }]);
}

/** Add an empty product tab; returns its id. Saved by the caller before
 *  anything else is written, so a later failure never orphans the tab. */
export async function addTab(title: string): Promise<string> {
  // New tabs go into the newest doc (the master until an extra one is added).
  const ids = await docIds();
  const docId = ids[ids.length - 1];
  const out = await batchUpdate(docId, [{ addDocumentTab: { tabProperties: { title } } }]);
  const reply = out.replies?.[0] as { addDocumentTab?: { tabProperties?: { tabId?: string } } } | undefined;
  const tabId = reply?.addDocumentTab?.tabProperties?.tabId;
  if (!tabId) throw new Error("Docs API did not return the new tab's id.");
  return joinTab(docId, tabId);
}

/** The overview lines at the top of a new product tab. The template
 *  tables are not copied in (yet) — the operator pastes them. */
export async function writeOverview(id: string, overview: { productName: string; links: string[] }): Promise<void> {
  const { docId, tabId } = splitTab(id);
  const text = [
    `Product name: ${overview.productName}`,
    `Competitor/example link: ${overview.links.join(" ")}`,
    "Alibaba link:",
  ].join("\n") + "\n";
  await batchUpdate(docId, [{ insertText: { location: { index: 1, tabId }, text } }]);
}

/** Tab ids, titles and codes only — no tab contents (much smaller than
 *  fetchDocTabs; read on every Import write). */
export async function listTabTitles(): Promise<Array<{ tabId: string; title: string; code: number | null }>> {
  const fields = "tabs(tabProperties(tabId,title),childTabs(tabProperties(tabId,title),childTabs(tabProperties(tabId,title))))";
  const all: Tab[] = [];
  for (const id of await docIds()) all.push(...flattenTabs(withDocIds(id, (await readDoc(id, fields)).tabs ?? [])));
  return all
    .filter((t) => t.tabProperties?.tabId)
    .map((t) => ({ tabId: t.tabProperties!.tabId!, title: t.tabProperties?.title ?? "", code: codeNumber(t.tabProperties?.title) }));
}

/** Every tab with its code and overview lines (for "Bring in from the doc"). */
export async function listTabsWithOverview(): Promise<Array<{ tabId: string; title: string; code: number | null; paragraphs: string[]; parents: string[] }>> {
  // Walk the tab tree keeping each tab's section ("To test" > "P97 - …"):
  // flattenTabs loses it, and Import only takes the tabs under "To test".
  const out: Array<{ tabId: string; title: string; code: number | null; paragraphs: string[]; parents: string[] }> = [];
  const walk = (tabs: Tab[], parents: string[]) => {
    for (const t of tabs) {
      const title = t.tabProperties?.title ?? "";
      if (t.tabProperties?.tabId) {
        out.push({
          tabId: t.tabProperties.tabId,
          title,
          code: codeNumber(title),
          paragraphs: (t.documentTab?.body?.content ?? []).filter((el) => el.paragraph).map((el) => paragraphText(el.paragraph)),
          parents,
        });
      }
      if (t.childTabs?.length) walk(t.childTabs, [...parents, title]);
    }
  };
  for (const id of await docIds()) walk(withDocIds(id, (await readDoc(id)).tabs ?? []), []);
  return out;
}
