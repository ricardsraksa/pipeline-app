# Import list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Products are entered in the pipeline (Import page), numbered and
prioritised there, mirrored to the master Google Doc as tabs, and started
from a Start runs page — replacing the copy-paste between doc and pipeline.

**Architecture:** Pure logic (code parsing, ordering/numbering, link
sorting, tab-overview parsing) lives in dependency-free modules under
`lib/import/` so `node --test` can run it. Persistence is a new
`import_items` table in `lib/db.ts`'s schema plus `lib/import/store.ts`.
Doc writes go through `lib/google/docs.ts`, whose request allow-list grows
by exactly two non-destructive types. Doc sync runs after each DB write,
fire-and-forget, recording failures on the item.

**Tech Stack:** Next.js 16 (non-standard — read `node_modules/next/dist/docs/`
before writing routes/pages), libsql/Turso, Google Docs REST v1 via
hand-rolled service-account auth, Tailwind, Node 24 (`node --test` with
built-in TS type stripping).

**Spec:** `docs/superpowers/specs/2026-10-08-import-list-design.md`

## Global Constraints

- Priority mark is `💦` (U+1F4A6). Only 💦 means priority when reading the doc.
- Tab title format: `💦 P<n> - <name>` (priority) / `P<n> - <name>`.
- Code parsing ignores leading emoji/symbols: `💦 P90 - Lamp` → 90.
- Docs requests allowed: `insertText` + the spike's create-tab request +
  `updateDocumentTabProperties` (rename). Nothing that deletes content.
- Instagram links (`instagram.com`, incl. `/reel/` and `/p/`) are references,
  never scraped. All other links are competitors, max 5.
- No delete of import items. Started runs are never renumbered.
- Never run dev/tests against the production Turso DB: use
  `TURSO_DATABASE_URL=file:data/dev-import.db`.
- UI: per the user's global CLAUDE.md, run
  `python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "internal ops dashboard table form" --design-system -p "Pipeline"`
  before UI tasks, but match the app's existing tokens/classes (`btn`,
  `var(--color-*)`, `ff-mono`). SVG icons only, `cursor-pointer` on
  clickables, ≥44px targets.
- Releases follow the repo convention: commit subject `vX.Y.Z: …` with `- `
  bullets, `package.json` version bump, `npm run changelog`.

## Review Focus

1. **Starting a row that isn't at the top** — it must get base + 1 and the
   rows above shift down; no gap, no duplicate. (Task 2 test
   `startLowerRowTakesNextNumber`.)
2. **Two imports landing at once** (both people importing) — numbers must
   stay unique and contiguous. Renumbering runs inside one libsql
   `batch(..., "write")`. (Task 3 test `concurrentImportsStayContiguous`.)
3. **A doc tab with no P code or a malformed title** ("Template", "P 7x",
   "💦💦 P93-Mug") — parsed or skipped, never crashes the list or the
   doc import. (Task 2 tests in `codes.test.mjs`.)
4. **Google unavailable / not configured** — Import still works; each item
   shows its doc error and the next renumber retries. (Task 4 test
   `syncRecordsErrorAndRetries` with a stubbed fetch.)
5. **Links box with junk** (blank lines, a non-URL word, >5 competitor
   links, the same link twice) — non-URLs flagged on the row, duplicates
   dropped, competitors capped at 5. (Task 2 test `splitLinksEdgeCases`.)

---

### Task 1: Spike — can the Docs API create and rename tabs?

Throwaway. Output is a findings note that fixes Task 4's tab-creation strategy.

**Needs from the operator (stop and ask):** a **copy** of the master doc
shared with the service account as Editor, its ID, and the service-account
key placed in `.env.local` as `GOOGLE_SERVICE_ACCOUNT_JSON` with
`GOOGLE_MASTER_DOC_ID=<copy id>`. Never point this at the real doc.

**Files:**
- Create: `scripts/spike-doc-tabs.mjs` (deleted after Task 4)
- Create: `docs/superpowers/plans/2026-10-08-import-list-spike.md`

- [ ] **Step 1:** Script that, against the copy: (a) sends `batchUpdate`
  with `addDocumentTab` `{ tabProperties: { title: "SPIKE P999 - Test" } }`;
  (b) renames it with `updateDocumentTabProperties` (fields `title`) to
  `💦 SPIKE P999 - Test`; (c) reads the template tab (title contains
  "template", case-insensitive) and reports its tables (rows × cols, label
  text, bold/background styles) and overview paragraphs.
- [ ] **Step 2:** Run `node --env-file=.env.local scripts/spike-doc-tabs.mjs`.
  Expected: new tab visible in the copy, renamed with 💦.
- [ ] **Step 3:** Try rebuilding the template into the new tab: insert the
  overview lines, then `insertTable` per template table and `insertText`
  for each label cell, applying the template's text style
  (`updateTextStyle`) and cell background (`updateTableCellStyle`).
  Compare visually with the operator.
- [ ] **Step 4:** Write the findings note: which request names work, the
  request list a faithful rebuild needs, and the decision —
  **A** rebuild (preferred if it looks right) or **B** create empty tab +
  overview lines and ask the operator to paste the template. List the
  exact request types to add to the allow-list.
- [ ] **Step 5:** Commit the note and script.

---

### Task 2: Pure logic — codes, ordering, numbering, links, tab overview

**Files:**
- Create: `lib/import/codes.ts`, `lib/import/numbering.ts`,
  `lib/import/links.ts`, `lib/import/tab-overview.ts` (no imports except
  relative type-only)
- Create: `tests/codes.test.mjs`, `tests/numbering.test.mjs`,
  `tests/links.test.mjs`, `tests/tab-overview.test.mjs`
- Modify: `package.json` (`"test": "node --test tests/"`),
  `eslint.config.mjs` (lint `tests/**/*.mjs` as plain JS if needed)

**Interfaces — Produces:**
- `codeNumber(text: string | null | undefined): number | null` —
  regex `/^[^\p{L}\p{N}]*P\s*0*(\d{1,6})\b/iu`.
- `isPriorityTitle(title: string): boolean` — `title.includes("💦")`.
- `tabTitle(code: string, name: string, priority: boolean): string`.
- `type OpenItem = { id: number; priority: boolean; createdAt: string }`
- `orderItems<T extends OpenItem>(items: T[]): T[]` — priority desc,
  createdAt asc, id asc.
- `assignCodes(base: number, items: OpenItem[]): Map<number, string>` —
  id → `P<base+i+1>` in `orderItems` order.
- `codeForStart(base: number): string` — `P<base+1>`.
- `splitLinks(raw: string | string[]): { references: string[]; competitors: string[]; invalid: string[] }`
  — split on whitespace/newlines, trim, dedupe, `^https?://` else invalid,
  host `instagram.com`/`www.instagram.com` → references, competitors capped 5.
- `type TabOverview = { productName: string | null; links: string[]; alibabaLink: string | null }`
- `readTabOverview(paragraphs: string[]): TabOverview` — reads the
  "Product name:", "Competitor/example link:", "Alibaba link:" lines
  (same label regexes as `planOverviewFills` in `lib/google/docs.ts`).

- [ ] **Step 1: Write failing tests**

```js
// tests/codes.test.mjs
test("emoji prefix", () => assert.equal(codeNumber("💦 P90 - Lamp"), 90));
test("double emoji, no space", () => assert.equal(codeNumber("💦💦 P93-Mug"), 93));
test("no code", () => assert.equal(codeNumber("Template"), null));
test("malformed", () => assert.equal(codeNumber("P 7x"), null));
test("priority", () => { assert.ok(isPriorityTitle("💦 P1 - A")); assert.ok(!isPriorityTitle("💧 P1 - A")); });
test("title", () => assert.equal(tabTitle("P92", "Mug", true), "💦 P92 - Mug"));
// tests/numbering.test.mjs
test("priority first then oldest", ...)  // lamp(t1), bowl(t2), mug(t3,priority) → mug, lamp, bowl
test("spec example", () => /* base 91 → mug P92, lamp P93, bowl P94 */);
test("startLowerRowTakesNextNumber", () => {
  // base 91, open [A P92, B P93, C P94]; start C → codeForStart(91) === "P92";
  // remaining [A,B] with base 92 → A P93, B P94
});
// tests/links.test.mjs
test("reel vs brand", ...) // instagram.com/reel/x → references; amazon.com/x → competitors
test("splitLinksEdgeCases", ...) // blanks ignored, "hello" invalid, dup dropped, 7 brands → 5
// tests/tab-overview.test.mjs
test("reads overview lines", ...) // ["Product name: Mug","Competitor/example link: https://a https://b","Alibaba link:"] → {productName:"Mug", links:[a,b], alibabaLink:null}
```

- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement the four modules.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Point existing callers at the new parser:
  `lib/product-code.ts` re-exports `codeNumber` from `lib/import/codes`;
  `findProductTab` in `lib/google/docs.ts` matches by
  `codeNumber(title) === codeNumber(code)`. `npm run build` passes.
- [ ] **Step 6:** Commit `feat: emoji-tolerant codes, import ordering and link sorting`.

---

### Task 3: Data — `import_items`, run columns, store, local DB

**Files:**
- Modify: `lib/db.ts` (allow `file:` URL without auth token; new table in
  `initDB`; `runs` columns `priority INTEGER`, `reference_urls TEXT` in the
  `newColumns` loop; `RunSummary` gains `priority`; `createRun` accepts
  `priority?: boolean; reference_urls?: string[]; product_name?: string`)
- Create: `lib/import/store.ts`
- Create: `tests/store.test.mjs` (uses `file:` temp DB via `@libsql/client`
  directly, mirroring the SQL in `store.ts`; if importing `store.ts` through
  `@/` aliases fails under node, test via a tiny `scripts/test-store.mjs`
  run with `npx tsx` — decide once, document in the test file)

**Interfaces — Produces (`lib/import/store.ts`):**
- `type ImportItem = { id; name; urls: string[]; priority: boolean; productCode: string; docTabId: string | null; docTitle: string | null; docError: string | null; createdAt; updatedAt; runId: number | null }`
- `listOpenItems(): Promise<ImportItem[]>` — `run_id IS NULL`, `orderItems` order.
- `addItems(rows: { name: string; urls: string[]; priority: boolean }[]): Promise<ImportItem[]>` — inserts with strictly increasing `created_at` (row order), then `renumber()`.
- `updateItem(id, patch: { name?; urls?; priority? }): Promise<ImportItem>` — then `renumber()`.
- `markStarted(id, runId, code): Promise<void>` — sets `run_id`, `product_code = code`, then `renumber()`.
- `adoptDocTabs(rows: { name; urls; priority; docTabId; docTitle }[]): Promise<ImportItem[]>`.
- `currentBase(docNumbersExcludingItems: number[]): Promise<number>` — max of run codes (`codeNumber(runs.product_code)`) and the given doc numbers.
- `renumber(base: number): Promise<ImportItem[]>` — computes `assignCodes`, writes all changed rows in one `db.batch([...], "write")`, returns items whose code changed.

Table:

```sql
CREATE TABLE IF NOT EXISTS import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, urls TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
  product_code TEXT, doc_tab_id TEXT, doc_title TEXT, doc_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, run_id INTEGER
)
```

- [ ] **Step 1:** Failing tests: `addKeepsRowOrder`, `priorityToggleRenumbers`
  (spec example), `markStartedLeavesList`, `concurrentImportsStayContiguous`
  (two `addItems` via `Promise.all` → codes P92..P95, no duplicates).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement store + schema.
- [ ] **Step 4:** Run → PASS. `npm run build` passes.
- [ ] **Step 5:** Commit `feat: import_items store`.

---

### Task 4: Doc sync — create, rename, adopt

**Files:**
- Modify: `lib/google/docs.ts` (allow-list per spike note; export
  `createProductTab`, `renameTab`, `listTabsWithOverview`)
- Create: `lib/import/doc-sync.ts`
- Delete: `scripts/spike-doc-tabs.mjs`
- Test: `tests/doc-sync.test.mjs` (stub `fetch`)

**Interfaces:**
- Consumes: `tabTitle`, `readTabOverview`, `isPriorityTitle`, `codeNumber`
  (Task 2); store functions (Task 3).
- Produces:
  - `createProductTab(title: string, overview: { productName: string; links: string[] }): Promise<{ tabId: string }>` — strategy A or B from the spike note.
  - `renameTab(tabId: string, title: string): Promise<void>`.
  - `listTabsWithOverview(): Promise<Array<{ tabId: string; title: string; code: number | null; priority: boolean; overview: TabOverview }>>`.
  - `syncItems(items: ImportItem[]): Promise<void>` — for each item, sequentially: no `docTabId` → create; `docTitle !== tabTitle(...)` → rename; success clears `doc_error` and stores `doc_title`; failure stores `doc_error` and continues. Never throws.
  - `docBase(): Promise<number[]>` — doc tab numbers excluding tabs owned by import items (by `docTabId`); `[]` when not configured.
- [ ] **Step 1:** Failing tests: `createsMissingTab`, `renamesChangedTitle`,
  `syncRecordsErrorAndRetries` (first fetch 500 → `doc_error` set; second
  sync succeeds → cleared), `assertNonDestructiveRejectsDelete`.
- [ ] **Step 2–4:** Implement, run → PASS.
- [ ] **Step 5:** Manual check against the copy doc: add 3 items via a
  scratch call, see 3 tabs; toggle priority on the last, see renames.
- [ ] **Step 6:** Commit `feat: import items sync to the master doc`.

---

### Task 5: API routes

Read `node_modules/next/dist/docs/01-app` route-handler docs first. Every
route starts with `requireSession(req)` like the existing ones.

**Files (create):**
- `app/api/import/route.ts` — `GET` → `{ items: ImportItem[] }`;
  `POST { rows: {name, links: string, priority}[] }` → validate with
  `splitLinks` (name required, ≥1 valid link, no invalid), `addItems`,
  then `void syncItems(changed)`; 400 lists bad row indexes.
- `app/api/import/[id]/route.ts` — `PATCH { name?, links?, priority? }`.
- `app/api/import/[id]/start/route.ts` — `POST { productUrl }`:
  `assertPublicUrl`, `code = codeForStart(base)`, `splitLinks(item.urls)`,
  `createRun({ product_url, product_name: item.name, competitor_urls, reference_urls, priority, product_code: code })`,
  `markStarted`, `runPipeline(runId)` fire-and-forget (copy
  `app/api/runs/start/route.ts`), sync renamed items, → `{ runId }`.
- `app/api/import/from-doc/route.ts` — `GET` → tabs from
  `listTabsWithOverview` whose code has no run and no import item, each with
  `suggested: !overview.alibabaLink`; `POST { tabIds }` → `adoptDocTabs`,
  renumber, sync.

- Modify: `lib/product-code.ts` — `nextProductCode()` returns
  `codeForStart(await currentBase(await docBase()))` (spec: replaces the
  v2.95.1 "runs only" rule); `/api/runs/next-code` reports the same.

- [ ] **Step 1:** Failing route tests aren't practical here; instead write
  `scripts/smoke-import.mjs` hitting each route on the local dev server
  (`file:` DB, copy doc) and asserting status + shape.
- [ ] **Step 2–4:** Implement, run smoke → PASS, `npm run build` passes.
- [ ] **Step 5:** Commit `feat: import API`.

---

### Task 6: Import page

**Files:**
- Create: `app/import/page.tsx`, `components/ImportTable.tsx`,
  `components/DocImport.tsx`, `components/icons/Splash.tsx` (SVG drop icon)

- [ ] **Step 1:** Run the ui-ux-pro-max design-system command (Global Constraints).
- [ ] **Step 2:** `ImportTable`: rows of name · links (textarea, grows) ·
  priority checkbox; a new empty row appears when the last row gets any
  text; Enter in name → links, Enter in links (without Shift) → next row's
  name; per-row errors from `splitLinks` shown inline; **Import all**
  disabled while any non-empty row is invalid; empty rows ignored. On
  success: clear table, toast "Imported N", list refresh.
- [ ] **Step 3:** Below the table, the recently imported open items
  (code, name, splash badge, doc status: "tab pending" / "in doc" / error
  text).
- [ ] **Step 4:** `DocImport`: "Bring in from the doc" button → modal list
  from `GET /api/import/from-doc` with checkboxes pre-set by `suggested`,
  → `POST`.
- [ ] **Step 5:** Verify on dev server (preview_start `pipeline-dev` with
  the `file:` DB): type 10 rows quickly, one invalid link blocks import,
  import, see codes P(base+1)… and tabs appear in the copy doc.
- [ ] **Step 6:** Commit `feat: Import page`.

---

### Task 7: Start runs page, nav, badges, rail links

**Files:**
- Replace: `app/new/page.tsx` (Start runs list)
- Create: `components/StartRow.tsx`
- Modify: `components/TopBar.tsx` (Home · Import · Start runs · Settings ·
  Changes), `app/HomeV2.tsx` (splash badge when `priority`),
  `lib/db.ts` `listRuns` (select `priority`),
  `app/runs/[id]/page.tsx:783` Links section (render `reference_urls`)

- [ ] **Step 1:** `StartRow`: code, splash badge, name, links (each a link;
  Instagram ones labelled "reel"), inline edit (name, links, priority →
  PATCH), AliExpress input + **Start** (disabled until https URL) → POST
  start → navigate to `/runs/<id>`.
- [ ] **Step 2:** Verify: start the top row → keeps its number; start the
  third row → it gets base+1 and rows above shift (Review Focus 1); a reel
  item starts with no competitors and shows the reel in the rail; a brand
  item's link appears as a competitor in Stage 1.
- [ ] **Step 3:** `npm run build` passes.
- [ ] **Step 4:** Commit `feat: Start runs page replaces New run`.

---

### Task 8: Release

- [ ] **Step 1:** `npm test` and `npm run build` pass.
- [ ] **Step 2:** Update `docs/SCREENS.md` (Import, Start runs; remove New run).
- [ ] **Step 3:** Bump `package.json` to `2.106.0`; commit
  `v2.106.0: products are imported in the pipeline, numbered and mirrored to the doc`
  with `- ` bullets; `npm run changelog`; amend the JSON into the commit.
- [ ] **Step 4:** Tell the operator: Render needs no new env vars; the
  service account already has Editor on the master doc. Don't push/deploy
  without their go-ahead.
