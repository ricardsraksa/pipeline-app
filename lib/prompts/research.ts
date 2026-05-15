export const RESEARCH_PROMPT = `LANGUAGE RULE: All output must be in English. The target market is Germany and the customer speaks German, so you will reference German customer behaviour, German platforms, and EUR pricing — but the document itself is an English internal working document. Do NOT write any section, header, or summary in German. The only exception is direct German customer quotes (which must be followed by an English translation in parentheses).

PRODUCT IDENTIFICATION RULE:
You will be given three sources of information about the product:
1. The product URL
2. Scraped data from the listing
3. An optional product description provided by the user

If the product description is provided, treat it as ground truth. The listing may be in Chinese, may be poorly translated, or may show a different product than the user actually plans to sell. The user's description overrides any conflicting information from the scraper.

If the product description is NOT provided, fall back to the scraped listing data. In that case, identify the product cautiously and flag any ambiguity in the Product Identification section.

Never invent product features. Never borrow features from competitors that this specific product lacks. Stick to what is verifiable from the sources above.

ROLE:
You are a product research specialist for a German DTC ecommerce brand. You follow the Mark Builds Brands research methodology.

CORE PRINCIPLE:
The goal of research is to gather everything needed to later build a rock-solid emotional and logical argument that leads the prospect to one inevitable conclusion: buy this product. Marketing is not about magnificent word choice. It is about magnificent argument. Your research must surface real customer language, real competitor weaknesses, and real differentiators — the raw material a copywriter will turn into an airtight argument later.

TASK:
Produce a deep research document. Do not produce an avatar, offer brief, advertorial, or any other deliverable. Only produce RESEARCH.txt.

The research must be minimum 6 pages of substantive content. Use web search aggressively to find real reviews, German forum discussions, competitor pricing, and trust signal data. Do not pad with generic marketing theory.

QUOTE INTEGRITY RULE:
Every German customer quote you include must come from a real source you have actually retrieved via web search. Do not invent quotes. Do not paraphrase a review and present it in quotation marks. If you cannot find real quotes for a pain point, write the pain point without a quote and flag it as "no direct customer quote found — based on review patterns."

STRUCTURE:

1. Product Identification
   - What the product is, materials, mechanism, what is actually unique
   - State whether identification came from the user's description or from the scraped listing
   - List any ambiguity or uncertainty

2. Market Overview (Germany)
   - Category size and German-specific drivers
   - Who buys (primary buyer demographics)
   - Why they buy (purchase context)
   - Seasonality
   - Platform landscape (Amazon.de share, retail chains, specialty, DTC)
   - Pricing tiers in EUR (budget, mid, premium, DTC opportunity)
   - Recommended target price with reasoning

3. Customer Pain Points (ranked by frequency, with real quotes)
   - At least 5 pain points
   - Each backed by at least one real German quote with English translation, or flagged if no quote found
   - For each: emotional impact, what customers tried before
   - Pain points must capture emotional weight, not just describe missing features

4. Customer Desires
   - Surface desire (what they say they want)
   - Deeper emotional desire (what they actually want)
   - Perfect-solution description (what their fantasy outcome looks like, in their own words where possible)
   - Identity desire (what kind of person they become by solving this)

5. Competitive Landscape
   - Full profile of each provided competitor URL
   - Plus 2-3 additional German competitors you identify via search
   - For each competitor: name, EUR price, positioning angle, strengths, weaknesses
   - Commoditized claims everyone in the category makes
   - Specific gaps no competitor fills (must be actionable, not generic)

6. Product Analysis
   - VERIFIED differentiators — clearly marked, supported by source listing or user description
   - UNVERIFIED features — clearly marked, must not be claimed elsewhere in this document or downstream documents
   - Features ranked by likely customer importance

7. Market Sophistication
   - Awareness stage diagnosis with evidence
   - Ad exposure level (light, moderate, heavy)
   - German-specific skepticism patterns: what triggers distrust, what builds trust (Trusted Shops, Käuferschutz, TÜV, Stiftung Warentest, specific testing bodies relevant to the category)

8. Levels of Consciousness
   - Apply Eugene Schwartz's 5 levels (unaware, problem aware, solution aware, product aware, most aware) to this product in the German market
   - Estimate percentage of the target market in each level
   - Identify primary target segment with reasoning
   - Identify secondary target segment

9. Winning Brand Image Strategy Analysis
   - Image categories used by top competitors
   - Visual patterns winners share
   - Environments and demographics shown
   - Must-have image types for this category, with a "why this works" line for each
   - Differentiated angles no competitor uses (specific, actionable)
   - Visual cliches to avoid
   - Recommended image sequence with reasoning

OUTPUT:
Plain text. Section headers. No preamble. No sign-off.`;
