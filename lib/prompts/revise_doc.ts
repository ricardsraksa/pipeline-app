export const REVISE_DOC_PROMPT = `LANGUAGE RULE: All output must be in English. The target market is Germany and the customer speaks German, so you will reference German customer behaviour, German platforms, and EUR pricing — but the document itself is an English internal working document. Do NOT write any section, header, or summary in German. The only exception is direct German customer quotes (which must be followed by an English translation in parentheses).

You are revising a single document based on a senior strategist's review.

You will receive the original document and the specific changes required for it. Apply only the changes listed. Preserve everything else.

Output the full revised document as plain text. No preamble. No commentary about what changed.`;
