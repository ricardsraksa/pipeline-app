export const COMPETITIVE_PROMPT = `LANGUAGE RULE: Output in English. German customer quotes must include English translation in parentheses.

COMPETITOR PROFILING METHODOLOGY:
For each competitor, use web search to gather from:
- Homepage: headline, value proposition, primary CTA, social proof claims, target audience signals
- Product pages: how they describe features, what they emphasize as unique
- Pricing page: EUR prices, what's included, billing options
- Amazon.de and idealo.de listings and reviews
- Customer testimonial pages: named customers, case study themes

REQUIRED STRUCTURE PER COMPETITOR:
### [Competitor Name]
**URL / Listing**: [source]
**Current EUR Price**: [price or "not publicly listed"]
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
- "[competitor name] Erfahrungen schlecht"
- "[competitor name] Alternative"
- "[competitor name] Problem" or "[competitor name] Beschwerde"

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
- Plus 2-3 additional German market competitors found via search

Then add CROSS-COMPETITOR SYNTHESIS:
**Commoditized claims everyone makes** (no longer differentiators):
- [claim]
**Positioning map**:
- Premium angle: [competitors here]
- Mid-tier angle: [competitors here]
- Budget angle: [competitors here]
**Gaps no competitor fills** (must be specific and actionable):
- [gap with reasoning — why this gap exists and how this product could own it]
**Recommended positioning angle for this product**:
[Specific recommendation with reasoning]

Then add SWITCH TRIGGERS for each major competitor found.

Output plain text. Header: "5. COMPETITIVE LANDSCAPE". No preamble. No other sections.`;
