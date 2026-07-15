// Format validation for the Stage 3 prompt-generation outputs (hero + the 8
// derivatives). Validation informs — it never blocks the QC gates; the human
// reviews and decides. Results are stored on the run as JSON (Stage3Validation).

const HEADERS = [
  'IMAGE TYPE:', 'OBJECTIVE:', 'PRODUCT CONTEXT:', 'SCENE INSTRUCTIONS:',
  'PRODUCT PLACEMENT:', 'BENEFIT TO COMMUNICATE:', 'TEXT OVERLAY:',
  'STYLE / CAMERA:', 'PRODUCT FIDELITY RULES:', 'NEGATIVE RULES:', 'OUTPUT FORMAT:'
];

const EXPECTED_CATEGORIES: Record<number, string> = {
  2: 'lifestyle', 3: 'problem_solution', 4: 'feature_callout',
  5: 'benefit_visualization', 6: 'before_after', 7: 'comparison',
  8: 'ugc_native', 9: 'review_social_proof'
};

/** Stored on the run (stage3_hero_validation / stage3_remaining_validation). */
export interface Stage3Validation {
  passed: boolean;
  errors?: string[];
  retried?: boolean;
}

export function validatePromptText(prompt: string): string[] {
  const errors: string[] = [];
  let last = -1;
  for (const h of HEADERS) {
    const idx = prompt.indexOf(h);
    if (idx === -1) { errors.push(`missing header ${h}`); continue; }
    if (idx < last) errors.push(`header out of order: ${h}`);
    last = idx;
  }
  if (!prompt.includes('No embedded text preferred.'))
    errors.push('missing "No embedded text preferred." line');
  if (!prompt.includes('Square 1:1 ecommerce-ready image, high-resolution,'))
    errors.push('OUTPUT FORMAT line does not start with the locked pattern');
  if (!prompt.toLowerCase().includes('reference image'))
    errors.push('no reference-image fidelity mention');
  return errors;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function validateHeroObject(obj: any): string[] {
  const errors: string[] = [];
  if (obj?.model !== 'gpt_image_2') errors.push(`hero model is ${obj?.model}, expected gpt_image_2`);
  if (obj?.aspect_ratio !== '1:1') errors.push('hero aspect_ratio is not 1:1');
  if (!Array.isArray(obj?.source_image_references) || obj.source_image_references.length === 0)
    errors.push('hero source_image_references missing or empty');
  if (typeof obj?.prompt !== 'string') { errors.push('hero prompt missing'); return errors; }
  return errors.concat(validatePromptText(obj.prompt));
}

export function validateRemainingArray(arr: any): string[] {
  const errors: string[] = [];
  if (!Array.isArray(arr) || arr.length !== 8) {
    errors.push(`expected array of 8 objects, got ${Array.isArray(arr) ? arr.length : typeof arr}`);
    return errors;
  }
  for (const obj of arr) {
    const tag = `[${obj?.index}/${obj?.category}]`;
    if (EXPECTED_CATEGORIES[obj?.index] !== obj?.category)
      errors.push(`${tag} wrong category, expected ${EXPECTED_CATEGORIES[obj?.index]}`);
    if (obj?.model !== 'gpt_image_2') errors.push(`${tag} model is ${obj?.model}`);
    if (obj?.aspect_ratio !== '1:1') errors.push(`${tag} aspect_ratio is not 1:1`);
    if (!('overlay_text' in (obj ?? {}))) errors.push(`${tag} overlay_text field missing`);
    if (!Array.isArray(obj?.source_image_references) || obj.source_image_references.length === 0)
      errors.push(`${tag} source_image_references missing or empty`);
    if (typeof obj?.prompt !== 'string') { errors.push(`${tag} prompt missing`); continue; }
    errors.push(...validatePromptText(obj.prompt).map(e => `${tag} ${e}`));
  }
  return errors;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
