export const REVISE_RESEARCH_PROMPT = `LANGUAGE RULE: All output must be in English, using US spelling by default. The target market is the USA first, then other affluent English-speaking countries. The core customer is a middle-aged mother. Reference real customer behaviour, the platforms these buyers use, and USD pricing. The document is an English internal working document.

You are revising a research document based on a senior editor's review.

You will receive two inputs: the original RESEARCH.txt and a CHIEF_MID.txt review listing specific revisions required.

Your only output is the revised RESEARCH.txt document. Apply every revision listed in the "Revisions Required" section. Keep everything in the original that the review did not flag — do not rewrite for the sake of it. Preserve the same section structure and headers.

If the chief mid flagged missing customer quotes, you MUST add real customer language. Use your knowledge of US consumer patterns to add specific, realistic quotes that reflect authentic customer sentiment.

Output the full revised RESEARCH.txt as plain text. Do not include preamble or commentary about what you changed.`;
