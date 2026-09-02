// Central model configuration.
//
// Every Anthropic call in the app belongs to one of a handful of logical roles
// (Stage 1 research, Stage 2 copy, Stage 3 prompts, Stage 3 audit, mechanical
// chores). Each role resolves its model from, in order: a saved selection in
// the DB (set via Settings), an env override, then a sensible default. This
// keeps model choice in one place and lets it be changed from the UI without a
// redeploy.

import { getKV, setKV } from "./db";

export type ModelRole = "product" | "stage1" | "stage2" | "stage3Prompt" | "stage3Edit" | "stage3Audit" | "mechanical";

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

// Models offered in the dropdowns. `id` is the exact string the API expects —
// keep in sync with the Claude model catalog.
export const MODEL_CATALOG: ModelOption[] = [
  { id: "claude-fable-5", label: "Fable 5", hint: "Most powerful · $10 / $50 per 1M" },
  { id: "claude-opus-5", label: "Opus 5", hint: "Top Opus · $5 / $25 per 1M" },
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Prior Opus · $5 / $25 per 1M" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Newest Sonnet · $3 / $15 per 1M" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "Balanced · $3 / $15 per 1M" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", hint: "Fast & cheap · $1 / $5 per 1M" },
];

export interface RoleMeta {
  label: string;
  description: string;
  env: string;
  default: string;
}

// Order here is the order shown in Settings.
export const ROLES: Record<ModelRole, RoleMeta> = {
  product: {
    label: "Stage 1 · Product",
    description: "The analyst pass: reads the scraped pages (and their photos) and writes the 120-word product description.",
    env: "PRODUCT_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage1: {
    label: "Stage 2 · Research",
    description: "The research & strategy documents (avatar, beliefs, competitive, etc.).",
    env: "STAGE1_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage2: {
    label: "Stage 3 · Copy",
    description: "The sales copy — the quality-critical creative output.",
    env: "STAGE2_MODEL",
    default: "claude-opus-5",
  },
  stage3Prompt: {
    label: "Stage 4 · Prompts",
    description: "Writing the hero + 8 image prompts and deciding image placement.",
    env: "STAGE3_PROMPT_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage3Edit: {
    label: "Stage 4 · Rewrites",
    description: "Rewriting/editing an existing image prompt from an operator note.",
    env: "STAGE3_EDIT_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage3Audit: {
    label: "Stage 4 · Auditor",
    description: "The vision check that passes/fails each generated image.",
    env: "STAGE3_AUDIT_MODEL",
    default: "claude-sonnet-4-6",
  },
  mechanical: {
    label: "Mechanical",
    description: "Cheap chores — JSON structuring, doc edits, one-pager synthesis.",
    env: "MECHANICAL_MODEL",
    default: "claude-haiku-4-5-20251001",
  },
};

// The newer model tier (Fable 5, Opus 4.8/4.7, Sonnet 5, …) removed the
// `temperature` / `top_p` / `top_k` sampling params and returns 400 if they are
// sent; older models (Sonnet 4.6, Haiku 4.5) still accept them. Allowlist the
// models known to accept sampling so anything new defaults to omitting it —
// omitting is always valid, whereas sending it to a rejecting model is a hard
// 400. (Ref: Claude API "Thinking & Effort" — sampling removed on 4.7+.)
const SAMPLING_PARAM_MODELS = new Set<string>([
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
]);

// Per-1M-token pricing for the cost tracker. Cache reads bill at 0.1× the
// input rate; writes bill 1.25× (5m TTL) or 2× (1h TTL) — the tracker prices
// all writes at 2× so it never understates (the big static prefixes use 1h).
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** Dollar cost of one call's token usage on a model. 0 for unknown models. */
export function costOfUsage(modelId: string, u: UsageTokens): number {
  const p = MODEL_PRICING[modelId];
  if (!p) return 0;
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_tokens * p.input * 0.1 +
      u.cache_write_tokens * p.input * 2.0) /
    1_000_000
  );
}

/** Whether it's safe to send temperature/top_p/top_k to this model id. */
export function modelSupportsSamplingParams(modelId: string): boolean {
  return SAMPLING_PARAM_MODELS.has(modelId);
}

const KV_PREFIX = "model_"; // app_kv key per role, e.g. model_stage1

export function isKnownRole(role: string): role is ModelRole {
  return role in ROLES;
}

function isValidModel(id: string | null | undefined): id is string {
  return !!id && MODEL_CATALOG.some((m) => m.id === id);
}

// Resolve the model for a role: saved DB selection → env override → default.
// A DB hiccup or an unknown saved/env value falls through to the default, so a
// call never fails just because of a bad setting.
export async function getModel(role: ModelRole): Promise<string> {
  const meta = ROLES[role];
  try {
    const saved = await getKV(KV_PREFIX + role);
    if (isValidModel(saved)) return saved;
  } catch {
    /* fall through */
  }
  const env = process.env[meta.env]?.trim();
  if (isValidModel(env)) return env;
  return meta.default;
}

export interface RoleSelection extends RoleMeta {
  role: ModelRole;
  selected: string;
  isDefault: boolean;
}

// All roles with their currently-resolved model — drives the Settings UI.
export async function getAllModelSelections(): Promise<RoleSelection[]> {
  const roles = Object.keys(ROLES) as ModelRole[];
  return Promise.all(
    roles.map(async (role) => {
      const selected = await getModel(role);
      return { role, ...ROLES[role], selected, isDefault: selected === ROLES[role].default };
    }),
  );
}

// Persist a selection. Validates both role and model so a bad POST can't store
// an unusable value.
export async function setModel(role: ModelRole, modelId: string): Promise<void> {
  if (!isKnownRole(role)) throw new Error(`Unknown model role: ${role}`);
  if (!isValidModel(modelId)) throw new Error(`Unknown model: ${modelId}`);
  await setKV(KV_PREFIX + role, modelId);
}
