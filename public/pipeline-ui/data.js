/* ============================================================================
   Mock data for the Pipeline prototype.
   A realistic German DTC product moving through the 3-stage pipeline, plus a
   set of seed runs for the Runs list. Exposed on window.PD.
   ============================================================================ */
(function () {
  // ── The hero product the live demo builds around ─────────────────────────
  const ONE_PAGER = `# NackenFlow — Cervical Traction Neck Hammock

## Product ID
A portable cervical traction device ("neck hammock") that cradles the head and applies gentle, gravity-assisted decompression to the cervical spine. Anchors to any door handle, post, or railing; user reclines for 10 minutes. Memory-foam neck cradle, adjustable nylon straps, travel pouch.

## Market
DE/AT/CH desk-workers 28–55 with screen-driven neck tension and "tech neck". Category sits between cheap inflatable pillows and €80+ clinical traction units — NackenFlow owns the €34–44 mid-tier with a premium-feel cradle.

## Avatar
Lena, 36, marketing lead in Hamburg. 9 hours a day at a laptop. Wakes with a stiff neck, ends the day with a tension headache. Has tried foam rollers and a massage gun; wants 10 quiet minutes that actually reset her neck without a physio appointment.

## Offer brief
€39 with a 60-night "feels-better-or-refund" guarantee. Free DE shipping. Bundle: add a second cradle for a partner at −30%. Lead with the 10-minute daily ritual, not the hardware.

## Necessary beliefs
1. Ten minutes of gentle traction can meaningfully release built-up neck tension.
2. It's safe to use at home without supervision.
3. The cradle is comfortable enough to actually relax into.
4. It works for *my* kind of desk-related stiffness.

## One-pager summary
NackenFlow is the 10-minute neck reset for screen-tired professionals. Position it as a daily ritual — not a medical device — that delivers the "post-massage" feeling at home. Hero the relief moment; let the hardware be quietly premium.`;

  const GERMAN_COPY = `HERO HEADLINE
In 10 Minuten den Nacken zurücksetzen — ohne Termin, ohne Schmerzmittel.

HERO SUBHEAD
NackenFlow ist die sanfte Nacken-Traktion für alle, die den ganzen Tag auf Bildschirme schauen. Einhängen, hinlegen, loslassen.

PROBLEM
Neun Stunden Laptop. Abends ein steifer Nacken, ein dumpfer Kopf. Foam-Roller und Massagepistole helfen kurz — die Spannung kommt zurück.

SOLUTION
Die memory-foam Nackenschale trägt den Kopf und lässt die Schwerkomme die Halswirbelsäule sanft entlasten. Zehn ruhige Minuten. Jeden Tag.

3 BENEFITS
• Spürbare Entlastung ab der ersten Anwendung
• Überall einsetzbar — jede Türklinke wird zur Praxis
• Premium-Nackenschale, die sich nicht billig anfühlt

SOCIAL PROOF
"Nach einer Woche keine Spannungskopfschmerzen mehr. Mein abendliches Ritual." — Lena H., Hamburg

OFFER
NackenFlow für €39 · 60 Nächte testen · kostenloser Versand · feels-better-or-refund Garantie

CTA
Jetzt den 10-Minuten-Reset sichern →`;

  // ── currentStep tick strings per stage (the "live log") ──────────────────
  const STEPS = {
    scraping: [
      "Resolving product URL…",
      "Scraping product page · aliexpress.com",
      "Scraping competitor 1/2 · amazon.de",
      "Scraping competitor 2/2 · idealo.de",
      "Normalising source images (3)…",
    ],
    stage1: [
      "Reading source material…",
      "Drafting Product ID + market…",
      "Building the customer avatar…",
      "Writing offer brief + necessary beliefs…",
      "Chief Editor pass · tightening claims…",
      "Composing the one-pager…",
    ],
    stage2: [
      "Loading approved research brief…",
      "Writing German hero headline…",
      "Drafting problem → solution arc…",
      "Generating benefit stack + social proof…",
      "Localising tone (DE/du-form)…",
      "Assembling copy kit…",
    ],
    generating_hero: [
      "Reading 3 source product photos…",
      "Composing hero scene + lighting…",
      "Rendering hero on Higgsfield…",
      "Upscaling + auditing hero…",
    ],
    generating_remaining: [
      "Hero approved — locked as reference.",
      "Writing lifestyle prompt…",
      "Writing problem→solution prompt…",
      "Writing feature-callout prompts…",
      "Writing social-proof prompt…",
      "Finalising 8 derivative prompts…",
    ],
  };

  // 8 derivative prompts (Stage-3 prompt QC gate)
  const REMAINING_PROMPTS = [
    { index: 2, image_type: "Lifestyle", category: "lifestyle", model: "soul-1.5", aspect_ratio: "4:5", german_text: "", prompt: "The product in use: a calm professional reclining on a sofa, head cradled in the neck hammock anchored to a door handle, soft late-afternoon window light, muted scandinavian interior, shallow depth of field, serene expression." },
    { index: 3, image_type: "Problem → Solution", category: "problem_solution", model: "soul-1.5", aspect_ratio: "1:1", german_text: "Steifer Nacken? 10 Minuten.", prompt: "Split composition: left, a tense person hunched at a laptop rubbing their neck; right, the same person relaxed using the neck hammock. Clean editorial styling, consistent product appearance from reference." },
    { index: 4, image_type: "Feature callout", category: "feature_callout", model: "soul-1.5", aspect_ratio: "1:1", german_text: "Memory-Foam Schale", prompt: "Macro detail of the memory-foam neck cradle and adjustable nylon strap, studio softbox lighting on a warm neutral seamless, crisp texture, premium materials emphasis." },
    { index: 5, image_type: "Benefit", category: "benefit_visualization", model: "soul-1.5", aspect_ratio: "4:5", german_text: "", prompt: "Visualising relief: a serene close-up of a person's face and shoulders releasing tension, eyes closed, warm soft light, the cradle subtly visible, spa-like calm." },
    { index: 6, image_type: "Before / After", category: "before_after", model: "soul-1.5", aspect_ratio: "1:1", german_text: "Vorher / Nachher", prompt: "Two-panel before/after of posture and expression, same person and lighting, honest and non-medical, consistent product from reference image." },
    { index: 7, image_type: "Comparison", category: "comparison", model: "soul-1.5", aspect_ratio: "1:1", german_text: "", prompt: "The neck hammock beside a bulky clinical traction unit and a cheap inflatable pillow, top-down on neutral surface, NackenFlow clearly the considered middle choice." },
    { index: 8, image_type: "UGC / Native", category: "ugc_native", model: "soul-1.5", aspect_ratio: "4:5", german_text: "", prompt: "Authentic phone-shot feel: the product anchored to an apartment door, slightly imperfect framing, natural light, lived-in but tidy home, native social vibe." },
    { index: 9, image_type: "Review / Social proof", category: "review_social_proof", model: "soul-1.5", aspect_ratio: "1:1", german_text: "★★★★★ \u201eMein Ritual\u201c", prompt: "Lifestyle shot with space for a 5-star review overlay, person content after use, warm tones, trustworthy and calm, consistent product appearance." },
  ];

  // Two-color meshes used to stand in for each generated image
  const MESH = [
    ["#cfe6da", "#7fae93"], ["#e7dcc6", "#bba06f"], ["#d4dce8", "#8fa3c4"],
    ["#e6d2cf", "#c08f88"], ["#d2e3df", "#86b4ab"], ["#dcdce6", "#9b9bb8"],
    ["#e3e0cd", "#b3ab84"], ["#d0e0d6", "#84ad95"], ["#e8d8d2", "#c39a8d"],
  ];

  // ── Seed runs for the Runs list ──────────────────────────────────────────
  const now = Date.now();
  const ago = (m) => new Date(now - m * 60000).toISOString();
  const SEED_RUNS = [
    { id: 248, brand_name: "PeloGrip", product_name: "Anti-slip Yoga Towel", product_url: "https://www.aliexpress.com/item/100500.html", status: "stage1", current_step: "Building the customer avatar…", last_updated_at: ago(0.4), created_at: ago(2) },
    { id: 247, brand_name: "AuraMist", product_name: "Portable Facial Steamer", product_url: "https://www.amazon.de/dp/B0CX12.html", status: "awaiting_qc", current_step: "8 prompts ready for review", last_updated_at: ago(11), created_at: ago(40) },
    { id: 246, brand_name: "NoktaSleep", product_name: "Weighted Sleep Mask", product_url: null, status: "awaiting_stage2_approval", current_step: "Research ready — approve to write copy", last_updated_at: ago(26), created_at: ago(33) },
    { id: 245, brand_name: "FjordKeep", product_name: "Insulated Bottle 750ml", product_url: "https://www.idealo.de/preisvergleich/x.html", status: "completed", current_step: null, last_updated_at: ago(95), created_at: ago(150) },
    { id: 244, brand_name: "ClearStep", product_name: "Shoe Deodoriser Balls", product_url: "https://www.aliexpress.com/item/772211.html", status: "failed", current_step: "Stage 2 — generating copy", last_updated_at: ago(190), created_at: ago(205) },
    { id: 243, brand_name: "VeloLume", product_name: "USB Bike Light Set", product_url: "https://www.amazon.de/dp/B0AA77.html", status: "completed", current_step: null, last_updated_at: ago(320), created_at: ago(380) },
    { id: 242, brand_name: "TerraPress", product_name: "French Press 1L", product_url: null, status: "cancelled", current_step: "Stage 1 — research", last_updated_at: ago(1450), created_at: ago(1470) },
    { id: 241, brand_name: "PuraDesk", product_name: "Desk Air Purifier", product_url: "https://www.idealo.de/x88.html", status: "completed", current_step: null, last_updated_at: ago(2880), created_at: ago(3000) },
  ];

  window.PD = {
    ONE_PAGER, GERMAN_COPY, STEPS, REMAINING_PROMPTS, MESH, SEED_RUNS,
    HERO_PRODUCT: {
      brand_name: "NackenFlow",
      product_name: "Cervical Traction Neck Hammock",
      product_url: "https://www.aliexpress.com/item/1005006677.html",
      product_description:
        "A portable cervical traction device (neck hammock) that cradles the head and uses gravity to gently decompress the cervical spine. Anchors to any door handle; the user reclines for 10 minutes. Memory-foam cradle, adjustable nylon straps, travel pouch. For desk-workers with screen-related neck tension.",
      competitorUrls: ["https://www.amazon.de/dp/B0_neck.html", "https://www.idealo.de/neck-traction.html"],
      sources: 3,
    },
  };
})();
