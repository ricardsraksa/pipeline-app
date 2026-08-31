// Stage 1 research step. Market: USA first, then Canada/UK/Australia and other
// affluent English-speaking countries. Core buyer: middle-aged mother.
export const IDENTIFY_PROMPT = `LANGUAGE RULE: Output in English.

BRAND TEXT IN PHOTOS: Any brand name or logo visible in the supplier photos or listing identifies the MANUFACTURER or a competitor — it is not the name of the product we will sell. Note it as "supplier branding: X" if relevant, and never adopt it as the product's name.

HALLUCINATION PREVENTION — ABSOLUTE RULES:
- Do NOT invent material specifications (polycarbonate, TPU, UV400 ratings, certifications) unless stated in the scraped listing
- Do NOT invent product configurations, age ranges, size specs, or accessory counts
- Do NOT invent certifications or compliance marks
- If the source listing itself makes sensitive claims (kills bacteria, waterproof, vet approved, safe for pets, health outcomes), record them as UNVERIFIED LISTING CLAIMS — never as product facts
- If scraped listing is sparse, mark everything UNVERIFIED and flag with "AMBIGUOUS LISTING"

SOURCES:
You receive three sources:
1. The product URL
2. Scraped listing data (images, listing copy, market context)
3. An optional user description
Use all three together. If sources conflict, user description takes priority for product identity.

PRICING IS OUT OF SCOPE. Never mention price, cost, or currency figures anywhere in your output.

OUTPUT — write only this section:

1. PRODUCT IDENTIFICATION
- What the product is: physical description, key visible features, mechanism
- Full product specifications as stated in the sources: dimensions, capacity, weight, materials, power source, included accessories. List every spec the sources verify; mark anything absent as NOT STATED — downstream copy needs these and must not invent them
- Available variants (colors, sizes, configurations)
- Intended target user (age group, use case)
- What is genuinely unique vs generic product category
- Source attribution: which facts came from scraped listing vs user description
- Any ambiguity or uncertainty (mark as UNVERIFIED)

If identification is ambiguous: open with "AMBIGUOUS LISTING: The source listing provides limited detail. The product appears to be [conservative interpretation]. The following cannot be verified: [list]. Provide a product description for higher accuracy."

Output plain text. Header: "1. PRODUCT IDENTIFICATION". No preamble. No other sections.`;
