# Pipeline — every screen in the app

A content inventory for a redesign. It says what each screen contains, what data
it shows and what the operator can do. It deliberately says nothing about
layout, colour, type, spacing or component style — all of that is open.

**What the app is.** A single-operator internal tool that takes a supplier
product link and produces a finished product page: a written description, market
research, positioning angles, a full copy kit, and nine generated images. Work
runs in the background; the operator is pulled in at four review gates. One
person uses it, on a desktop, often with a run open for a long time while
generation runs.

**The four stages.** 1 Product · 2 Research · 3 Copy · 4 Images. Every run walks
them in order and stops at a gate between each.

---

## 1. Login

The only screen visible when logged out. Everything else redirects here.

- App name.
- One password field, one sign-in button.
- Error text when the password is wrong ("Wrong password.") or when the app has
  no password configured.
- After sign-in the operator returns to the page they were trying to reach.

---

## 2. Global chrome (on every signed-in screen)

- App name and version of the deployed build.
- Three destinations: Home, New run, Settings.
- A badge showing how many runs currently need the operator.
- Light/dark toggle.
- Toast messages appear here for saves, failures and completions.

---

## 3. Home

The run inbox. Three groups, each with a count:

- **Needs you** — runs stopped at a gate or failed. Each row carries a short
  reason: "Review the product / Description and photos", "Pick an angle /
  Research is done", "Ready for images / Hero first, then the 8", "Review the
  hero / Reference for the other 8", "Review the 8 prompts / Then generate",
  "Run failed / Resume to continue".
- **Running** — runs currently working, with the step they're on.
- **Recent** — completed and cancelled runs.

Each row: thumbnail (generated hero if there is one, else a source photo, else a
generated pattern), product/brand name, product code (e.g. "P58"), run number,
status, relative time, product URL, delete.

Also: a search field filtering by name, code or run number; an empty state
("No runs yet" / "Nothing matches …"); a link to start a new run.

---

## 4. New run

Three inputs and one button. Nothing is generated here — submitting creates the
run and the work starts in the background.

1. **Product link** (required, https). Hint: AliExpress, Alibaba, Shopify. Error
   when it isn't a full link.
2. **Competitor / brand links** (optional, up to 5, one per line). Note: read for
   positioning only.
3. **Your own photos** (optional, up to 10, drag or click; the scraped listing
   photos are added automatically).

Submit is "Run pipeline" (also ⌘↵). It can show "Starting…" and an error box.

---

## 5. Run — the workspace

Where nearly all time is spent. One run, four stages; the operator sees one
stage at a time and the app follows the pipeline to whichever needs attention.

**Always present, whatever stage is open:**

- Run identity: thumbnail, editable name, run number, product code, elapsed time,
  link to the product URL, status.
- The four stages with their state each: done, running, needs you, failed, or
  not started yet. Clicking one opens it.
- What is happening right now, in plain words ("Stage 2: Market overview (2/5)",
  "Reading the product page…").
- Cost so far: number of API calls, tokens, cache reads/writes, dollars.
- Price: the suggested retail price and compare-at from the Pricing card, with
  the multiple of COGS. Opens Stage 3.
- Downloads: the research and copy documents; the generated images.
- Kill (while running), Resume (after a failure or cancel), Restart this stage.
- A persistent "what to do next" line with a single action, e.g. "Pick an angle
  → Pick an angle", "Ready for copy → Run copy", "Review the hero → Review hero".

### Stage 1 · Product

While working: a progress line ("Reading the product page…"). Pages that need a
real browser take about a minute.

At the gate, two halves:

- **What was read** — one row per link: product or competitor, the site, whether
  it worked, and what came back (title, price, rating, review count, units sold,
  number of option groups, photo counts). Failed rows show why.
- **The description** — the model's ~200-word plain-prose description of what the
  product physically is and does, editable in place, with a word count,
  "Regenerate description" and "Restore original".
- **The photos** — every photo the run has, grouped: your photos, listing photos,
  description images, competitor photos. Each is tickable (max 10). "Add my
  photos" uploads more.
- **Approve & start research.**

Special case: when the supplier site blocks the app's scraper, this stage shows a
notice with a terminal command to run on the operator's Mac, the state of that
background worker ("Your Mac is scraping this page", "Checked in 2 min ago",
"Mac worker offline", "couldn't get this page"), and the option to write the
description by hand instead.

### Stage 2 · Research

While working: a progress line (identify → market → competitive → product
analysis → avatar/offer/beliefs → one-pager → angles).

At the gate, two halves:

- **The one-pager** — a formatted research summary (headings, paragraphs, lists):
  what the product is, market, competition, customer, offer.
- **The angles** — 4–6 proposed positioning angles, each with: a short title, a
  badge for how contested that ground is (open / partly claimed / crowded), the
  problem, the stakes if unsolved, why this product's mechanism fixes it, who
  feels it most, an opening hook line, what competitors currently say, and the
  gap being taken. Rows collapse to title + problem and expand for the rest.
  - The operator ticks one or more. The first tick is the **primary** angle
    everything is built around; the rest are **supporting**. "Make primary"
    reorders.
  - Any angle's wording can be edited.
  - "Write my own" opens the same fields blank and adds an operator angle.
  - "New angles" regenerates, with an optional steer ("more health-focused").
- Also here: regenerate the research from a note, thumbs up/down with a note, the
  exact prompt this run used, download the foundational documents, a note when
  competitor links couldn't be read.

Copy cannot start until at least one angle is chosen.

### Stage 3 · Copy

Above everything else on this stage, from the moment Stage 1 is approved: the
**Pricing** card. COGS (from the AliExpress price, editable, with its currency),
suggested Price and Compare-at (both editable), one line with the multiple and
margin, the competitor price range with median and where this price sits, one
chip per competitor, red flags when a rule is broken (below the minimum
multiple, wrong ending, compare-at outside the range, above every competitor,
below the cheapest), "Reset to rules". Not part of the copy; no prompt reads it.

Under it, the **Variants** card from the AliExpress listing: each option group
(Colour, Size…) with its values and a copy-values button, and a table of every
SKU with its AliExpress price and the price/compare-at the rules give it (sold
out SKUs dimmed). The same card sits above the Shopify push on Stage 4.

While working: "Generating copy…".

Then the finished copy kit, in two views:

- **Full text** — the whole kit as editable text, with an edited-at stamp,
  revert, and download.
- **Fields** — the kit split into the exact rows the storefront expects: badge
  text, title support text, three benefits, what's included, two FAQ
  question/answer pairs, three section headline/paragraph pairs. Each row is
  individually copyable.

Also: send the kit to the product's tab in the master Google Doc (with a note
when it was last sent), regenerate from a note, thumbs up/down, the prompt used,
restart the stage.

### Stage 4 · Images

Several consecutive states, one after the other:

1. **Start** — choose which source photos may be used as references (click to
   exclude/include), then "Generate hero" or "Skip hero — use source images".
2. **Generating the hero.**
3. **Review the hero** — the generated hero shot, fullscreen view, the prompt
   behind it (editable), "Edit with AI" with an instruction box, "Regenerate
   hero", "Approve hero — generate rest".
4. **Writing the 8 prompts.**
5. **Review the 8 prompts** — one card per image showing what the image will
   show: a plain summary, the scene, the benefit it communicates, the overlay
   text, and which reference images it uses. Per card: edit the full prompt, or
   rewrite it with an AI instruction. Plus extra reference images (scene/style)
   that the prompt writer may attach. Then "Generate 8 images".
6. **Generating** — progress per image, with "Stop after current".
7. **Complete** — the hero plus the 8 images in a grid, each openable fullscreen,
   each with a pass/fail verdict from the automatic audit and the reasons, with
   the ability to override a verdict, regenerate one image, or bulk-fix all
   failed ones with a single instruction.
   - **Auto-place images** assigns one image to page section 2 and one to
     section 3, judged against that section's headline and paragraph from the
     copy; the rest become gallery/product shots. Section 1 is a GIF the
     operator adds manually. Section tiles show the headline they sit beside
     and the reason for the pick. The operator can override: "→ S2 / → S3" on
     any image, "Swap 2 ↔ 3", and — when a placed image was regenerated since —
     a notice with Keep / Re-place. The prompt writer authors one image per
     section up front; placement confirms or overrides it.
   - **Push to Shopify** — one button: sets the product title, writes the copy
     into the product's metafields and appends the images. Never publishes,
     never deletes, never touches price. Reports per field what was set,
     skipped or missing.
   - **Send images to Drive** — uploads them to the product's folder.
   - **Relink / recover from Higgsfield** — pulls images that generated but were
     never saved.
   - Download all images.

Failure states appear inline anywhere in this flow: an image that failed, a
generation interrupted by a restart, the model refusing a reference photo.

---

## 6. Settings

Three blocks.

- **Models** — one row per pipeline role (Stage 1 product, Stage 2 research,
  Stage 3 copy, Stage 4 prompts, Stage 4 rewrites, Stage 4 auditor, mechanical),
  each with a one-line description, the current model, a picker with price per
  million tokens, and what the default is.
- **Pricing rules** — minimum multiple of COGS, price ending, compare-at
  min/max above price; default markers; save.
- **Prompts** — one block per stage (Stage 1 Product, Stage 2 Research, Stage 2
  Angles, Stage 3 Copy, Stage 4 Images). Each: a large editable prompt, a
  "modified" marker when it differs from the built-in default, when it was saved,
  save / reset to default, and a version history that can be previewed and
  restored.

---

## 7. Redirects and legacy

- `/history` and `/history/<id>` — old links; both forward into Home or the run.
- `/stage3` — the previous standalone image workflow, still reachable, replaced
  by Stage 4 inside the run. Not part of the redesign.
- `/preview` — a full-screen frame showing an older vendored design prototype.
  Staging surface only.

---

## Notes for whoever redesigns this

- One user, desktop, long sessions. Density is fine; hand-holding is not.
- The four gates are the whole product. Everything else is waiting.
- A run can sit at a gate for hours and be returned to later, so a run must
  always answer "where am I and what do I do next" immediately.
- Most screens have a working state, a review state, an empty state and a failure
  state. All four matter.
- Text on screen is short by design: labels and one-line explanations, no
  paragraphs of instructions.
