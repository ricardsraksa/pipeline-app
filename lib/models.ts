// Central model configuration.
//
// Every Anthropic call in the app belongs to one of a handful of logical roles
// (Stage 1 research, Stage 2 copy, Stage 3 prompts, Stage 3 audit, mechanical
// chores). Each role resolves its model from, in order: a saved selection in
// the DB (set via Settings), an env override, then a sensible default. This
// keeps model choice in one place and lets it be changed from the UI without a
// redeploy.

import { getKV, setKV } from "./db";

export type ModelRole = "stage1" | "stage2" | "stage3Prompt" | "stage3Audit" | "mechanical";

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

// Models offered in the dropdowns. `id` is the exact string the API expects —
// keep in sync with the Claude model catalog.
export const MODEL_CATALOG: ModelOption[] = [
  { id: "claude-fable-5", label: "Fable 5", hint: "Most powerful · $10 / $50 per 1M" },
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Top Opus · $5 / $25 per 1M" },
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
  stage1: {
    label: "Stage 1 · Research",
    description: "The research & strategy documents (avatar, beliefs, competitive, etc.).",
    env: "STAGE1_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage2: {
    label: "Stage 2 · Copy",
    description: "The German sales copy — the quality-critical creative output.",
    env: "STAGE2_MODEL",
    default: "claude-opus-4-8",
  },
  stage3Prompt: {
    label: "Stage 3 · Prompts",
    description: "Writing & editing image prompts and deciding image placement.",
    env: "STAGE3_PROMPT_MODEL",
    default: "claude-sonnet-4-6",
  },
  stage3Audit: {
    label: "Stage 3 · Auditor",
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
