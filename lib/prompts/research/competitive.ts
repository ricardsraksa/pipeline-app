export const COMPETITIVE_PROMPT = `LANGUAGE RULE: Output in English.

COMPETITOR PROFILING METHODOLOGY:
For each competitor, use web search to gather from:
- Homepage: headline, value proposition, primary CTA, social proof claims, target audience signals
- Product pages: how they describe features, what they emphasize as unique
- What's included / bundle composition (NOT price — pricing is out of scope)
- Amazon.com (and .co.uk/.ca/.com.au) listings and reviews (ignore the prices shown)
- Customer testimonial pages: named customers, case study themes

PRICING IS OUT OF SCOPE for this entire analysis. Never state a competitor's price, a currency figure, or a "budget/mid/premium" price band. Positioning is judged on messaging, features, and audience — not price.

REQUIRED STRUCTURE PER COMPETITOR:

### [Competitor Name]
**URL / Listing**: [source]
**Positioning angle**: [how they position in one phrase]
**Primary value proposition**: [their core promise]
**Target audience**: [who they speak to, based on copy analysis]
**Key messaging themes**:
- [theme 1]
- [theme 2]
**Strengths** (with evidence):
- [strength] — evidenced by [source]
**Weaknesses** (with evidence):
- [weakness] — evidenced by customer complaints or review patterns
**What they are NOT saying** (gaps you can exploit):
- [specific gap]

SWITCH TRIGGERS — search for each major competitor:
- "[competitor name] reviews problems"
- "[competitor name] alternative"
- "[competitor name] complaint" or "[competitor name] disappointed"

Format switch triggers as:

### Switch Triggers — Why Buyers Leave [Competitor Name]
1. [reason with evidence]
2. [reason with evidence]
3. [reason with evidence]

QUALITY RULES:
- Every competitor claim must be traceable to their listing/website or real customer reviews
- Identify at least 3 competitors total (provided URLs plus 2-3 found via search)
- Gaps must be actionable, not generic ("better customer service" is not a gap)

---

OUTPUT — write only this section:

5. COMPETITIVE LANDSCAPE
Include:
- Full profile of each provided competitor URL using the structure above
- Plus 2-3 additional competitors active in the US / English-speaking markets found via search

Then add CROSS-COMPETITOR SYNTHESIS:

**Commoditized claims everyone makes** (no longer differentiators):
- [claim]

**Positioning map** (by messaging angle, NOT price tier):
- Quality / durability angle: [competitors here]
- Convenience / ease angle: [competitors here]
- Design / aesthetic angle: [competitors here]
- Health / safety angle: [competitors here]
(Use whatever angles actually appear — these are examples, not a fixed list. Never use price as an axis.)

**Gaps no competitor fills** (must be specific and actionable):
- [gap with reasoning — why this gap exists and how this product could own it]

**Recommended positioning angle for this product**:
[Specific recommendation with reasoning]

Then add SWITCH TRIGGERS for each major competitor found.

Output plain text. Header: "5. COMPETITIVE LANDSCAPE". No preamble. No other sections.`;
