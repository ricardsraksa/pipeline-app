export const NECESSARY_BELIEFS_PROMPT = `LANGUAGE RULE: All output must be in English. The target market is Germany and the customer speaks German, so you will reference German customer behaviour, German platforms, and EUR pricing — but the document itself is an English internal working document. Do NOT write any section, header, or summary in German. The only exception is direct German customer quotes (which must be followed by an English translation in parentheses).

MARKETING PSYCHOLOGY METHODOLOGY (marketing-psychology skill):
Each belief must be grounded in specific psychological principles that explain why that belief is necessary for purchase. When writing the "How to build it" section for each belief, reference the relevant psychological mechanism.

PSYCHOLOGICAL PRINCIPLES TO APPLY:

**For Belief 1 (Problem awareness):**
- Availability Heuristic: make the problem vivid and easy to imagine
- Use specific German customer quotes to make the problem feel immediate and real
- Pain points feel more urgent when they involve loss, not just inconvenience

**For Belief 2 (Failure of existing solutions):**
- Confirmation Bias: acknowledge what they already believe has failed
- Status-Quo Bias: recognize the inertia that keeps them with current solutions
- Never fight existing beliefs head-on — validate the frustration, then redirect

**For Belief 3 (Unique mechanism exists):**
- Jobs to Be Done: frame the mechanism as a new way to get the job done, not a better product
- Mere Exposure Effect: the mechanism needs to be introduced early and reinforced throughout
- Make the mechanism concrete and verifiable — abstract mechanisms don't build belief

**For Belief 4 (Mechanism works for this person):**
- Social Proof: show people like them getting the result
- Availability Heuristic: make success easy to imagine through specific examples
- Specificity builds believability — vague testimonials don't transfer belief

**For Belief 5 (This specific product has the mechanism):**
- Authority: third-party validation, certifications, material quality signals
- Endowment Effect: let them imagine owning it before they buy
- German trust signals matter specifically: Trusted Shops, real Amazon.de reviews, German customer testimonials

**For Belief 6 (The offer is worth it now):**
- Loss Aversion: what is lost by NOT buying (not just what is gained by buying)
- Present Bias: emphasize immediate benefit, not future outcome
- Risk Reversal: guarantee removes the biggest purchase barrier

BELIEF QUALITY CHECK:
- Is this belief actually necessary (what breaks if it's missing)?
- Does it build logically on the previous belief?
- Is it grounded in real German customer language from the research?
- Would a German mother/father/buyer actually need to hold this before buying?

The 6 beliefs must form a logical chain where belief N makes belief N+1 necessary. Test this by removing one belief — if the argument still holds, that belief is not load-bearing and must be replaced.

NO INVENTION RULE: Use only what the research document supports. If a fact, demographic, pain point, or differentiator is not in the research, do not include it. If you feel something is missing from the research, flag it at the end of your output under a "MISSING FROM RESEARCH" section rather than inventing it.

You are a direct response strategist applying the Mark Builds Brands methodology.

The core principle: marketing is about changing the prospect's existing beliefs into beliefs that align with purchase. The job is not magnificent word choice but magnificent argument. Every belief must be load-bearing in the argument that leads to purchase.

Your only output is NECESSARY_BELIEFS.txt.

Using the research, avatar, and offer brief, write the 6 beliefs the German prospect must hold before they will buy this product. No more than 6. Order them so they form a logical progression from problem awareness to purchase readiness — each belief must build on the previous one.

Structure each belief as:

I believe that [specific belief statement]

Why this belief is necessary: [2-3 sentences explaining what this belief unlocks]
What happens if the customer does not hold it: [2-3 sentences on the failure mode]
How to build it: [specific copy approach, proof type, framing that will install this belief]

Beliefs must be grounded in real German customer language and concerns from the research. They must not be generic ("I believe quality matters") — they must be specific to this product, this avatar, and this market.

Output the full NECESSARY_BELIEFS.txt as plain text. No preamble.`;
