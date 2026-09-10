// Stage 1 research step. Market: USA first, then Canada/UK/Australia and other
// affluent English-speaking countries. Core buyer: middle-aged mother.
export const PRODUCT_ANALYSIS_PROMPT = `LANGUAGE RULE: Output in English.

HALLUCINATION PREVENTION:
- VERIFIED: only features explicitly stated in the scraped listing or user description
- UNVERIFIED: anything not in the sources — must be clearly labeled and never used in marketing claims
- If scraped listing is sparse, default to conservative interpretation and flag uncertainty

---

OUTPUT — write only these sections:

6. PRODUCT ANALYSIS
- VERIFIED differentiators: mark each [VERIFIED] — supported only by source listing or user description
  For each: what it is, why it matters mechanically, which pain point from Section 3 it solves
- UNVERIFIED features: mark each [UNVERIFIED] — list what should NOT be claimed without proof
- Features ranked by likely customer importance (cross-reference the pain points in Section 3)

6B. THE BASELINE ALTERNATIVE
Name the common lesser version of this product in the same category: what most of these buyers use today or would buy by default. It is a material, construction or type, never a brand. Plastic cooking utensils, not a rival brand of wooden ones. A still water bowl, not another fountain. Foam ear plugs, not a competing silicone plug. Every comparison made downstream (angles, copy, images, ads) is made against this, so choose the one she actually has in her kitchen, bathroom or car.
- Baseline: [one plain phrase]
- Why it is the baseline: [one sentence: who buys it and why]
- Criteria: 3 to 5, ranked by how strongly she feels each. For each, one line in this shape:
  [Criterion] — [what the baseline does] / [what this product does instead, VERIFIED only] — "[the consequence in her own words]"
  Example: Sheds into food — plastic scratches and sheds fragments into hot food / solid beech does not scratch or shed [VERIFIED: solid beech] — "I don't want bits of plastic in the kids' dinner"
- Only use a criterion this product can back with a [VERIFIED] fact from the listing or description. Say what the material or construction does; never claim a health outcome it cures or prevents.

7. MARKET SOPHISTICATION
Diagnose which of Eugene Schwartz's five stages of sophistication this category is in for the US-led English-speaking market. The stage is decided by how many similar products this buyer has already been sold, not by how good this product is:
- Stage 1 — nothing like it has been advertised to her; the plain claim is still news
- Stage 2 — the claim works and competitors are outbidding each other on it (bigger, faster, more)
- Stage 3 — every version of the claim has been made; she discounts them, and only a new mechanism (a new HOW) makes the old promise believable again
- Stage 4 — the mechanisms have been copied too, and competitors are now elaborating on each other's mechanism
- Stage 5 — she believes neither claims nor mechanisms in this category; only identification with her situation gets a hearing
State the stage, then the evidence: what the competitor listings and ads in the research are actually leading with, and whether that is a bare claim, an outbid claim, a mechanism, an elaborated mechanism, or identification. If competitors are leading with mechanisms, the market is at least Stage 3.
- Skepticism patterns:
  - What triggers distrust in buyers for this category
  - What specifically builds trust: Trustpilot reviews, verified-purchase Amazon reviews, BBB accreditation, third-party lab testing, money-back guarantees, recognizable certification marks — only mention the ones actually relevant
  - Consumer archetypes for this category (e.g. "researches for weeks before buying", "reads every review", "trusts word of mouth and mom groups only")

8. LEVELS OF CONSCIOUSNESS
Apply Eugene Schwartz's 5 levels to this product in the US-led English-speaking market:
- Unaware: [% estimate] — what they're experiencing but not yet framing as a problem
- Problem Aware: [% estimate] — know they have the problem, haven't found a solution category
- Solution Aware: [% estimate] — know solutions exist, comparing options
- Product Aware: [% estimate] — know this type of product exists, evaluating brands
- Most Aware: [% estimate] — have bought before, looking to upgrade or switch
Primary target segment: [which level to target and why — based on market size and conversion opportunity]
Secondary target segment: [which level and why]

Then, as the last two lines of your output, restate the primary diagnosis in exactly this form and nothing else on those lines. The pipeline reads these two lines directly, so the wording must match:
AWARENESS: [Unaware | Problem Aware | Solution Aware | Product Aware | Most Aware]
SOPHISTICATION: [1 | 2 | 3 | 4 | 5]

The awareness value is the PRIMARY target segment you named above, not the largest segment and not a range. The sophistication value is the stage you diagnosed in section 7.

Output plain text. Headers: "6. PRODUCT ANALYSIS", "6B. THE BASELINE ALTERNATIVE", "7. MARKET SOPHISTICATION", "8. LEVELS OF CONSCIOUSNESS". No preamble. No other sections.`;
