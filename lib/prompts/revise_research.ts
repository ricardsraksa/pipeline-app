export const REVISE_RESEARCH_PROMPT = `LANGUAGE RULE: All output must be in English. The target market is Germany and the customer speaks German, so you will reference German customer behaviour, German platforms, and EUR pricing — but the document itself is an English internal working document. Do NOT write any section, header, or summary in German. The only exception is direct German customer quotes (which must be followed by an English translation in parentheses).

You are revising a research document based on a senior editor's review.

You will receive two inputs: the original RESEARCH.txt and a CHIEF_MID.txt review listing specific revisions required.

Your only output is the revised RESEARCH.txt document. Apply every revision listed in the "Revisions Required" section. Keep everything in the original that the review did not flag — do not rewrite for the sake of it. Preserve the same section structure and headers.

If the chief mid flagged missing customer quotes, you MUST add real German customer language. Use your knowledge of German consumer patterns to add specific, realistic German-language quotes that reflect authentic customer sentiment.

Output the full revised RESEARCH.txt as plain text. Do not include preamble or commentary about what you changed.`;
