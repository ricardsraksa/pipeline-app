# Import list — design

Date: 2026-10-08 · Status: agreed in chat, awaiting spec review

## Why

New products are found by a second person (from Instagram reels → the
original listing, usually a brand site or Amazon) and added as tabs in the
master Google Doc. The operator then re-types each one into the pipeline's
New run form. Priority products are marked with a 💧 in the tab title, which
the pipeline's code parser does not understand, so P numbers drift.

Goal: products are entered **in the pipeline**, the doc stays the record
and backup (the pipeline writes it), and nothing is pasted between the two.
Everything from "Start run" onward is unchanged.

## What the operator sees

### Import (new group at the top of Home)

- **Add product** form has three fields: **Product name** (for reference,
  like in the doc), **Product link** (the original listing) and a
  **Priority** tick. Name and link are both required. The link can be the
  original listing (brand site, Amazon) or an Instagram reel. Anyone signed in can
  add (same password as today).
- **Many at once:** the form is a table of rows (name · link · priority)
  with **+ Add row**, and **Import all** adds every row in one go. Built for
  typing many in a row: a fresh empty row appears as soon as the last one
  is filled, and Enter moves to the next field. Rows missing a name or link
  are flagged and block Import all; fully empty rows are ignored.
- Every item shows its **provisional P number** at once. Within one import,
  rows keep their table order (priority rows still go first).
- Order: priority items first, then the rest, each by date added (oldest
  first). Priority items carry a water-drop badge (SVG icon, not emoji).
- Row actions: edit, toggle priority, **Start run**. No delete — products
  added to Import are not removed.

### Numbering

- **Base** = highest number among started runs and doc tabs that do not
  belong to an Import item.
- Import items are numbered `base + 1, base + 2, …` in list order.
- Adding an item or toggling priority on an item renumbers the Import
  items whose position changed. Example: base P91, list is P92 lamp, P93
  bowl; a priority mug is added → P92 mug, P93 lamp, P94 bowl.
- A number is **locked for good** when Start run is pressed. Started runs
  are never renumbered.
- Code parsing ignores any leading emoji / symbols: `💧 P90 - Lamp` → 90.
  The same parser is used by the Docs export, so sending copy finds 💧 tabs.

### The Google Doc

- Adding an item creates its tab immediately, titled
  `[💧 ]P<n> - <product name>`, from the template, with the overview lines
  filled: "Product name:" and "Competitor/example link:" (the product link).
- A batch import creates its tabs one after another (Docs API write limits);
  the list shows each row's tab as pending until it exists.
- When an item's number or priority changes, the pipeline renames its tab.
  Only Import items' tabs are ever renamed.

### Start run

- Opens today's New run form pre-filled: product code locked to the item's
  number, run name = the product name. A listing link goes in the
  competitor field (scraped as today); a reel link (instagram.com,
  including /reel/ and /p/) is kept as a reference only, never scraped. The
  operator pastes the AliExpress link and submits; the run starts as today.
- The run stores `priority` (badge on Home) and, for a reel, `reference_url`
  (clickable in the rail's Links section).
- The Import item is marked started (`run_id` set) and leaves the list.

## Data

- New table `import_items`: `id, name, url, priority (0/1), product_code,
  doc_tab_id, created_at, updated_at, run_id NULL`.
- New `runs` columns (same `ALTER TABLE … ADD COLUMN` loop as today):
  `priority INTEGER`, `reference_url TEXT`.
- Renumbering runs in one function (`renumberImports()`) that computes the
  target code for every open item, updates rows, then renames changed tabs.
  Tab renames happen after the DB write; a failed rename is recorded on the
  item and retried on the next renumber, never blocking the list.

## Google Docs changes

- `lib/google/docs.ts` currently allows `insertText` only. Add exactly two
  request types: **create tab** and **rename tab** (tab properties update).
  Still nothing that deletes content.
- `CODE_RE` / `codeNumber` / `findProductTab` become emoji-tolerant.
- `nextProductCode()` changes from "runs only" (v2.95.1) to the Base rule
  above.

## Prerequisite spike (before any build)

Confirm against a **copy** of the master doc, shared with the service
account:

1. The Docs API can create a tab, and whether it can copy the template
   tab's tables or only create an empty tab.
2. The Docs API can rename a tab.

Fallback if (1) only gives an empty tab: the pipeline creates the tab,
writes the overview lines, and rebuilds the template tables by inserting
them (more code), or asks the operator to paste the template — decided
after the spike.

## Out of scope

- Any change to Stages 1–5, Shopify, Drive.
- Trello. (Trello cards group launched P numbers; this design keeps P
  numbers in work order so that keeps working.)
- Importing the doc's existing tabs. (Optional one-off later.)

## Testing

The repo has no test runner. Pure functions (`codeNumber`, the ordering /
numbering function) get a small `node --test` file. End-to-end check on the
dev server against the copy doc: enter a 10-row batch, toggle priority, watch numbers
and tab titles change, start a run from a listing link and from a reel link, confirm code,
competitor field and reference link.
