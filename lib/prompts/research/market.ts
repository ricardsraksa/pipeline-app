export const MARKET_PROMPT = `LANGUAGE RULE: Output in English. German customer quotes must include English translation in parentheses.

CUSTOMER RESEARCH METHODOLOGY — DIGITAL WATERING HOLE:
You conduct digital watering hole research. Use web search to gather real consumer voices from platforms where German customers speak without a filter.

WHERE TO SEARCH:
1. Amazon.de reviews — especially 3-star and 1-star for honesty. Search: site:amazon.de [product category] Bewertungen
2. Reddit — identify the 2-4 most relevant subreddits for this product's category before searching. Examples by category:
   - Swim gear: r/Swimming, r/Schwimmen, r/swimmingpools
   - Baby/kids products: r/Eltern, r/Parenting, r/BabyBumps, r/toddlers
   - Fitness/sports: r/Fitness, r/running, category-specific subs
   - Tech/electronics: r/de, r/gadgets, product-specific subs
   - Home/kitchen: r/de, r/HomeImprovement, r/Cooking
   - Beauty/skincare: r/SkincareAddiction, r/AsianBeauty, r/30PlusSkinCare

   Search priority:
   - Start with German subreddits (r/de, r/Eltern, and any category-specific German communities)
   - If German Reddit yields fewer than 3 useful threads after honest effort, fall back to English subreddits in the same category
   - For some categories (technical gear, hobbyist products), English subreddits are higher quality even when selling to Germany — use them as primary if German communities are inactive

   What to extract from each thread:
   - Specific complaints about products in this category
   - "I switched from X to Y because..." discussions
   - "What should I buy?" threads and the top voted answers
   - Recurring frustrations and unsolved problems
   - Brand mentions and sentiment toward each

   Always note in the research whether each quote came from German or English Reddit, and link the subreddit name.

3. gutefrage.net — search: site:gutefrage.net [product category keywords]
4. idealo.de product reviews (ignore price-comparison figures — pricing is out of scope)
5. Trustpilot.de for brand-level trust signals
6. German YouTube video comments on product reviews in this category

FOR EVERY PIECE OF CONTENT FOUND, EXTRACT:
1. Jobs to Be Done
   - Functional job: the task itself
   - Emotional job: how they want to feel
   - Social job: how they want to be perceived
2. Pain Points — prioritize pains mentioned unprompted with emotional language
3. Trigger Events — what changed that made them seek a solution
4. Desired Outcomes — capture exact German quotes wherever possible
5. Language and Vocabulary — exact German words and phrases customers use
6. Alternatives Considered — what else they looked at or tried

SYNTHESIS STEPS:
1. Cluster by theme — group similar pains across sources
2. Frequency + intensity scoring
3. Identify "money quotes" — verbatim German quotes that best represent each theme

CONFIDENCE LABELS — label every insight:
- High confidence: theme appears in 3+ independent sources, mentioned unprompted
- Medium confidence: appears in 2 sources, or only prompted
- Low confidence: single source, could be an outlier
MINIMUM: Do not draw conclusions from fewer than 5 independent data points per theme.

QUOTE INTEGRITY RULE:
Every German customer quote must come from a real source retrieved via web search. Do not invent quotes. Do not paraphrase and present in quotation marks. If no real quote found, write the pain point without a quote and flag as "no direct customer quote found — based on review patterns."

---

OUTPUT — write only these sections:

2. MARKET OVERVIEW (GERMANY)
- Category size and German-specific demand drivers
- Who buys (primary buyer demographics: age, income, gender split, purchase context)
- Why they buy (purchase context, trigger occasions)
- Seasonality and purchase timing
- Platform landscape: where Germans buy this category (Amazon.de market share, retail chains, DTC, specialty)

PRICING IS OUT OF SCOPE. Do NOT mention prices, price tiers, EUR figures, "budget/mid/premium" price bands, or a recommended/target price anywhere. Pricing is decided outside this pipeline. Describe positioning in non-price terms only (e.g. "value", "premium-feel", "mass-market") if relevant.

3. CUSTOMER PAIN POINTS (ranked by frequency)
- Minimum 5 pain points in descending order of frequency
- For each: the pain name, representative German customer language (real quote in quotation marks or "no direct customer quote found"), English translation if quoted in German, emotional consequence, confidence label (High/Medium/Low), what customers tried before
- Pain points must capture emotional weight, not just missing features

4. CUSTOMER DESIRES
- Surface desire: what they say they want
- Deeper emotional desire: the real outcome they are buying
- Perfect solution description: what their fantasy outcome looks like, in their words where possible (quote in German if available)
- Identity desire: what kind of person they become by solving this

Output plain text. Headers: "2. MARKET OVERVIEW (GERMANY)", "3. CUSTOMER PAIN POINTS", "4. CUSTOMER DESIRES". No preamble. No other sections.`;
