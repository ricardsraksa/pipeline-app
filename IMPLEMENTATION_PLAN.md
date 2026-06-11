# Pipeline — fixes implementation plan

Every improvement from the audit, sequenced by dependency + ROI. Each item is
self-contained: goal, files, steps, how to verify, effort, risk.

Convention: `[ ]` not started · `[~]` in progress · `[x]` done.
Effort: S ≤30min · M ≈1–3h · L ≈half-day+.

Already shipped (for context, do not redo):
- v1.51 reliability: durable cancel, Stage-3 watchdog rescue, retries/timeouts,
  per-image persistence + resume, dead-end recovery.
- v2.0.0: SQL `stage` whitelist (the injection fix), dead-code purge.

---

## PHASE A — Quick wins (no dependencies, do first)

### [x] A1 · Prompt caching on the big system prompts — S, high ROI
**Goal:** Stop re-paying for the 230-line Stage 2 (Opus) + 350-line image prompts
on every call. ~10–15% cost + faster first token.
**Files:** `lib/pipeline-runner.ts` (`anthropicMessage`), `lib/stage3/hero.ts`,
`app/api/stage3/audit/route.ts`, `app/api/stage3/placement/route.ts`,
`app/api/stage3/edit-prompt/route.ts`, `app/api/stage3-prompts/route.ts`,
`app/api/stage1-one-pager/route.ts`.
**Steps:**
1. Change every `system: "<string>"` to the cacheable array form:
   `system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }]`.
2. In `anthropicMessage()` accept the system as-is and wrap once there so all
   Stage-1/2 calls inherit it.
3. Only cache the **static** system prompt — never put the per-run user content
   in the cached block.
**Verify:** run a Stage 2 + a Stage 3 prompt gen; check the API response
`usage.cache_creation_input_tokens` (first call) then `cache_read_input_tokens`
(second call within 5 min) are non-zero.
**Risk:** none. Cache miss just behaves like today.

### [x] A2 · Feedback-loop polish — S
**Goal:** cleaner signal into future prompts.
**Files:** `lib/feedback.ts`, `lib/pipeline-runner.ts:~216`.
**Steps:**
1. Dedupe `recent(stage)` by `(brand_name, product_name)` — keep newest verdict
   per product before `LIMIT`.
2. Cap each note at ~200 chars in `format()`.
3. Bump the "good Stage-2 examples" truncation from 300 → ~600 chars
   (`pipeline-runner.ts` query that slices `stage2_output`).
**Verify:** thumbs a couple of runs, start a new run, log the assembled feedback
block — confirm dedup + caps.
**Risk:** none.

### [x] A3 · Opus option for Stage-3 prompt gen — S
**Goal:** cut the malformed-JSON retries (`generateRemainingPrompts` already
retries 3× + jsonrepair — symptom of Sonnet straining on 8-template JSON).
**Files:** `lib/stage3/hero.ts` (the `MODEL` const).
**Steps:**
1. `const MODEL = process.env.STAGE3_PROMPT_MODEL?.trim() || "claude-sonnet-4-5-20250929"`
   (mirror the `STAGE2_MODEL` pattern).
2. Leave default = Sonnet; test `claude-opus-4-8` via env, compare retry rate.
**Verify:** generate prompts a few times with each; count parse-retry warnings.
**Risk:** Opus costs more per call — keep it env-gated, default off.

---

## PHASE B — Stage 2 structured output (the one you said you want) — L

Do after Phase A. Touches the copy view you tuned (11pt-Arial Docs paste) — keep
that intact via a server-rendered text view.

### [~] B1 · Make STAGE2_PROMPT emit JSON — IMPLEMENTED DIFFERENTLY
**Decision:** did NOT touch the tuned Stage 2 prompt (would risk copy quality +
the whole-kit Docs paste). Instead added a cheap Haiku *structuring* pass
(`lib/stage2/format.ts` → `structureStage2Copy`) that derives the JSON from the
canonical free text verbatim, post-generation. Zero risk to copy quality; the
free text stays the source of truth. Schema as below.
`{ product_name, badge, supporting_sentence, benefits:[3], sections:[3]{headline,paragraph}, was_enthalten, faqs:[2]{q,a}, facebook:{headline,primary,description}, one_liners:[5] }`.

### [x] B2 · Parse + validate + render in the runner
**Files:** `lib/pipeline-runner.ts` (Stage 2 step), new `lib/stage2/format.ts`.
**Steps:**
1. Parse JSON (jsonrepair fallback, mirror hero.ts).
2. Validate shape (3 benefits, 3 sections, 2 FAQs, 5 one-liners) — on failure,
   keep the raw text and flag `stage2_parse_warning`.
3. `renderStage2Text(json)` → the same human-readable layout as today, so the
   existing copy-to-Docs path is byte-compatible.

### [x] B3 · DB
**Files:** `lib/db.ts` (migrate + Run/RunStatus types), status route.
**Steps:** add `stage2_json TEXT`. Keep `stage2_output` = the rendered text
(back-compat + Docs paste). Old runs with no JSON fall back to text view.

### [x] B4 · Copy view
**Files:** `components/EditableOutput.tsx` or a new `Stage2Structured.tsx`, run page.
**Steps:** when `stage2_json` exists, render per-field cards with a copy button
each (and the existing 11pt-Arial whole-kit copy stays). Per-section feedback
optional follow-up.
**Verify:** new run → JSON parses, fields render, every copy button works,
whole-kit paste into Google Docs still lands as 11pt Arial. Old run → text view.
**Risk:** medium — the Docs-paste formatting is the thing to not regress. Test it
explicitly before shipping.

---

## PHASE C — Stage 3 speed (parallelize) — M, gated on C1

Biggest UX win (4–7 min → ~1.5–2 min) but **C1 is mandatory first** or runs go flaky.

### [x] C1 · Token-refresh mutex (PREREQUISITE)
**Goal:** the Higgsfield MCP refresh token rotates on use; concurrent image calls
would refresh simultaneously and invalidate each other → 401s.
**Files:** `lib/higgsfield-mcp.ts` (`getAccessToken`/`doRefresh`).
**Steps:** wrap refresh in a single-flight promise — if a refresh is in flight,
other callers await the same promise instead of starting their own.
**Verify:** fire 3 concurrent `generateImageViaMcp` calls in a script; all
succeed, only one refresh in the logs.
**Risk:** low; it only serializes the auth step.

### [x] C2 · Parallelize the 8-image loop at concurrency 3
**Files:** `components/Stage3HeroFlow.tsx` (`generateAll`).
**Steps:** replace the sequential `for` with a 3-wide worker pool. Keep: per-image
upsert persist, resume-from-missing, audit per image. Change "Stop after current"
→ "Stop after current batch" (stopRef checked between batches).
**Verify:** generate 8; watch ~3 tiles light up at once; kill the tab mid-batch →
reopen → resumes from the unfinished ones.
**Risk:** Higgsfield 429 bursts — already retried; 3-wide stays under typical caps.

### [skip] C3 · (optional) Batch the 8 audits into 1 vision call — DELIBERATELY SKIPPED
**Files:** `app/api/stage3/audit/route.ts` (new batch route), `Stage3HeroFlow.tsx`.
**Steps:** one Claude vision call with all 8 images + prompts → 8 verdicts.
Saves ~7 calls + ~30s. Only worth it after C2.
**Risk:** medium (new prompt + parse); skip if C2 already feels fast enough.
**Why skipped:** C2 already delivers the speed win (3-wide generation dominates
wall-time), and A1 cached the audit system prompt so the per-call cost is mostly
gone. Batching would *regress* the C2 UX — it forces waiting for all 8 images
before any verdict shows, instead of each tile flipping pass/fail as it
completes. Net negative now. Re-open only if audit cost becomes a real concern.

### [x] C4 · Audit reasons → one-click regen
**Goal:** close the loop — failed-image `issues` should drive the fix, not your typing.
**Files:** `components/Stage3HeroFlow.tsx` (`BulkFixModal`, `regenerate`).
**Steps:** pre-fill each failed prompt's rewrite instruction with its own audit
`issues` ("avoid: <issues>"); "Fix all failed" becomes one click that already
knows what's wrong.
**Verify:** force a fail verdict → open fix-all → instructions are pre-populated
from the audit reasons.
**Risk:** none.

---

## PHASE D — Optional hardening (you deprioritized security; cheap, opt-in)

### [x] D1 · SSRF guard on the scraper — S
**Files:** `app/api/scrape/route.ts`.
**Steps:** before fetching a user URL, reject `localhost`/`127.*`/`10.*`/
`172.16–31.*`/`192.168.*`/`169.254.*` and non-http(s). Stops the server being
pointed at internal addresses.
**Risk:** none (only blocks private targets).

### [x] D2 · Input length caps — S
**Files:** `app/api/runs/[id]/route.ts` (PATCH), `app/api/runs/start/route.ts`.
**Steps:** cap big text fields (notes, descriptions, prompts) at a sane max
(e.g. 20k chars) → 400 on overflow. Prevents accidental DB bloat / OOM.
**Risk:** none if the cap is generous.

---

## Suggested order
1. **A1, A2, A3** — one afternoon, all low-risk wins (cost + quality).
2. **B (Stage 2 structured)** — the feature you actually want.
3. **C1 → C2** — the speed win, when speed matters (C1 is non-negotiable first).
4. **C4** — small, satisfying, do alongside C.
5. **C3, D1, D2** — nice-to-haves, only if the itch is there.

Each item ships as its own commit (typecheck-gated) so nothing's all-or-nothing.
