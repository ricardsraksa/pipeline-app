export const IDENTIFY_PROMPT = `LANGUAGE RULE: Output in English. German customer quotes must include English translation in parentheses.

HALLUCINATION PREVENTION — ABSOLUTE RULES:
- Do NOT invent material specifications (polycarbonate, TPU, UV400 ratings, certifications) unless stated in the scraped listing
- Do NOT invent product configurations, age ranges, size specs, or accessory counts
- Do NOT invent certifications or compliance marks
- If scraped listing is sparse, mark everything UNVERIFIED and flag with "AMBIGUOUS LISTING"

SOURCES:
You receive three sources:
1. The product URL
2. Scraped listing data (pricing, images, listing copy, market context)
3. An optional user description

Use all three together. If sources conflict, user description takes priority for product identity; scraped data takes priority for pricing/market signals.

OUTPUT — write only this section:

1. PRODUCT IDENTIFICATION
- What the product is: physical description, key visible features, mechanism
- Available variants (colors, sizes, configurations)
- Intended target user (age group, use case)
- What is genuinely unique vs generic product category
- Source attribution: which facts came from scraped listing vs user description
- Any ambiguity or uncertainty (mark as UNVERIFIED)

If identification is ambiguous: open with "AMBIGUOUS LISTING: The source listing provides limited detail. The product appears to be [conservative interpretation]. The following cannot be verified: [list]. Provide a product description for higher accuracy."

Output plain text. Header: "1. PRODUCT IDENTIFICATION". No preamble. No other sections.`;
