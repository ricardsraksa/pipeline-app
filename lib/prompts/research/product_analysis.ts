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

7. MARKET SOPHISTICATION
- Awareness stage diagnosis: which Eugene Schwartz stage does the typical buyer (the middle-aged mom in the US-led English-speaking market) start at? Provide evidence for this diagnosis.
- Ad exposure level in this category in the US / English-speaking markets: light / moderate / heavy — with reasoning
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

Output plain text. Headers: "6. PRODUCT ANALYSIS", "7. MARKET SOPHISTICATION", "8. LEVELS OF CONSCIOUSNESS". No preamble. No other sections.`;
