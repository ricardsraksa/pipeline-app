# Pipeline workflow — improvement notes

Audit of the 3-stage pipeline (research → German copy → images) for speed, cost,
and output quality. Findings are grounded in the actual code (file:line refs),
prioritized by impact ÷ effort. Nothing here is implemented yet — it's a menu.

Date: 2026-06-11 · v2.0.2

---

## TL;DR — the 5 that matter

| # | Change | Win | Effort | Risk |
|---|--------|-----|--------|------|
| 1 | **Parallelize the 8 Stage-3 images** | ~4–7 min → ~1.5–2 min | Med | Higgsfield rate-limit / credit bursts |
| 2 | **Prompt caching (`cache_control`)** on the big system prompts | ~10–15% cost, faster TTFT — most on Opus Stage 2 | Low | None |
| 3 | **Auto-feed audit reasons into regeneration** | Less manual fixing, better images | Med | None |
| 4 | **Stage 2 → structured JSON output** | Per-section feedback, validation, cleaner paste | High | Changes the copy workflow |
| 5 | **Try Opus for the Stage-3 8-prompt gen** | Fewer malformed-JSON retries | Low | Slightly higher cost/call |

Stage 1 is already well-built — leave it.

---

## Stage 1 (research) — already good, minor only

- 10 Claude calls happy-path (13 with revisions). Mostly Sonnet 4.5; revisions +
  one-pager on Haiku. ~35–45s wall-clock, no web search.
- **Already parallelized** where it counts: product-analysis ∥ visual, and
  avatar ∥ offer-brief ∥ beliefs (`lib/pipeline-runner.ts` `Promise.all`/
  `allSettled`). Good.
- Web search is **off by default** (`RESEARCH_WEB_SEARCH=on` to enable); adds
  ~30–60s when on. Leave off unless a category needs live German sources.
- Minor: research text is re-sent to ~9 calls. Prompt caching (#2) would recover
  most of that input cost. Not worth restructuring otherwise.

**Verdict: don't touch Stage 1 except via the global caching change.**

---

## Stage 3 (images) — the biggest lever in the whole app

### 1. The 8-image loop is sequential — `components/Stage3HeroFlow.tsx` `generateAll()`
Each image runs **generate → audit → persist**, fully `await`-ed, one at a time.
- Per image: Higgsfield gen+poll ~20–40s + audit ~3–8s ≈ **~30s**.
- 8 images ≈ **4–7 minutes** of staring at a spinner.
- **Fix:** run them with a concurrency cap (e.g. `Promise.all` over a pool of
  2–3). At 3-wide that's ~3 batches ≈ **~1.5–2 min**. The per-image persist +
  resume logic already added makes this safe — a failure or tab-close still only
  loses in-flight items.
- **Tradeoffs to decide:**
  - Higgsfield rate limits / credit spend come in bursts instead of a trickle.
  - "Stop after current" becomes "stop after current batch."
  - 3-wide is the sweet spot (fast, won't trip rate limits). Don't go 8-wide.
  - **⚠ The real caveat (not rate limits): the Higgsfield MCP refresh token
    rotates on every use (`lib/higgsfield-mcp.ts` `doRefresh`/`getAccessToken`).**
    Sequential calls share one valid access token. Three *concurrent* image
    calls could each trigger a refresh at once and invalidate each other's token
    → spurious 401s mid-run. So parallelizing isn't just `Promise.all` — it
    needs a **mutex around the token refresh** (one refresh in flight, the
    others await it) first. That's why this is "medium effort," not trivial.
    The 429 / credit-burst stuff is the *minor* risk; the token-refresh race is
    the one that would actually break a run.
  - **DECISION (2026-06-11): user wants the risk understood before committing.
    Not implemented. Revisit when speed becomes the priority.**

### 2. Audit = 1 Claude vision call per image (`app/api/stage3/audit/route.ts`)
8 separate vision calls. Could batch all 8 into **one** call (all images + their
prompts, return 8 verdicts). Saves ~30–40s + 7 calls of cost. Medium effort
(new audit prompt + parse). Lower priority than #1 once images run in parallel.

### 3. Audit reasons don't auto-drive regeneration
A "fail" verdict stores `issues` (e.g. "product recolored", "warped text") but the
regenerate prompt **doesn't use them** — you fix it manually. The "Fix all failed"
modal exists but you type the instruction. **Better:** pre-fill each failed
prompt's rewrite with its own audit `issues` ("avoid: …") so one click fixes them
with the auditor's actual reasons. Closes the loop.

### 4. Placement is fine
One vision call over all images at the end (`app/api/stage3/placement`). Correct
as-is — runs after generation, ~5–8s.

### 5. Higgsfield polling — `lib/higgsfield-mcp.ts`
3s interval, 180s cap, `sync:true` blocks ~25s/poll. Fundamental to image time;
not worth tuning. Generation speed is Higgsfield's, not ours.

---

## Stage 2 (German copy) — quality + cost

### Prompt caching (#2) — confirmed absent
No `cache_control` anywhere in the codebase. The 230-line Stage 2 prompt is
re-sent **on every Opus 4.8 call** (Opus input is the priciest token in the app),
and the 350-line image-prompt system re-sends per Stage-3-prompt gen. Wrapping
these system prompts in `cache_control: { type: "ephemeral" }` is a near-free
10–15% cost cut + faster first token. **Highest ROI, lowest effort.**

### Output is freeform text, not structured (#4)
`stage2_output` is one TEXT blob. You read it and paste sections into the PDP /
Google Doc by hand. Switching the prompt to emit **JSON** (product_name, badge,
supporting_sentence, 3 benefits, 3 headline/paragraph pairs, FAQ, FB copy, 5
one-liners) would enable: structure validation (caught: "only 2 benefits"),
per-section feedback ("benefits weak"), and a clean rendered view + copy-per-field.
Bigger change, and it touches the paste-into-Docs flow you specifically tuned —
so only if the manual copy step is actually annoying you.

### Feedback loop — working, two small polish items
`lib/feedback.ts` correctly labels 👍/👎 and tells the model "👎 = avoid" (the
earlier "good and bad treated the same" claim was **wrong** — verified). Real,
minor gaps:
- No dedupe: the same product rated 5× shows 5 rows (`recent()` is `LIMIT 5`, no
  GROUP BY). Dedupe by product so one product ≠ the whole window.
- No length cap on notes (a long note bloats the prompt). Cap ~200 chars.
- "Good examples" block pulls full text of past 👍 Stage-2 outputs truncated to
  300 chars — bump to ~600 so the structure is visible, or store a tighter
  summary.

### Prompt length / attention
The 230-line constraint wall is a lot for the model to hold while writing. Opus
handles it, but if quality ever wobbles, the move is **two-pass**: generate copy
loosely, then a second cheaper pass that only enforces the forbidden-phrase /
slop rules. Not urgent — flagging as a lever.

---

## Model assignment — one possible tweak
- Stage 2 = Opus 4.8 ✓ (justified — heaviest rule-following).
- Stage 3 prompt gen = Sonnet 4.5. It occasionally returns malformed JSON (we
  already retry 3× + `jsonrepair`). Trying Opus here (behind an env flag like
  Stage 2 has) could cut the retries. Cheap experiment.
- Stage 1 + one-pager = Sonnet/Haiku ✓.

---

## Decisions so far (2026-06-11)
- **Priority right now: none — "it's fine, just the notes."** Nothing to build
  yet; this is a backlog to pull from later.
- **Stage 3 parallelize:** undecided — wanted the risk explained (the token-
  refresh race above is the real one). Park it.
- **Stage 2 structured output: WANTED.** User said per-field structure would
  help. This is the most likely first build when they're ready. Scope below.

## When Stage 2 → structured is picked up (the wanted one)
- Change `STAGE2_PROMPT` to emit JSON: `{ product_name, badge, supporting_sentence,
  benefits[3], sections[3]{headline,paragraph}, was_enthalten, faqs[2]{q,a},
  facebook{headline,primary,description}, one_liners[5] }`.
- Parse + validate in the pipeline (catch "only 2 benefits", missing FAQ).
- Store the JSON **and** a rendered markdown/text view (so the 11pt-Arial
  copy-to-Docs flow we tuned still works — render server-side, don't lose it).
- New copy view: per-field copy buttons + per-section feedback.
- Keep the raw text fallback for any run created before the switch.

## Still-open questions (sizing, not blockers)
1. **Regenerations:** how often do images fail audit and need a redo? (Sizes the
   audit→regen auto-loop.)
2. **Volume:** roughly how many runs/week? (Sizes the prompt-caching cost win.)
