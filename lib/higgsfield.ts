// Higgsfield platform API connector.
//
// Verified against https://docs.higgsfield.ai (current):
//   Base URL : https://platform.higgsfield.ai
//   Submit   : POST /{model_id}                   body: { prompt, aspect_ratio, resolution }
//   Poll     : GET  /requests/{request_id}/status
//   Auth     : Authorization: Key {KEY_ID}:{KEY_SECRET}
//
// `model_id` is a path-style identifier such as "higgsfield-ai/soul/standard".
// The platform routes POST /{model_id} directly — there is NO /v1/text2image/x
// or /v1/image2image/x endpoint. Short names like "nano_banana_2" are not valid
// model_ids; that mismatch is what produced HTTP 404 "Model not found".
//
// Credentials: set HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET separately, OR
// set HIGGSFIELD_CREDENTIALS in the format "KEY_ID:KEY_SECRET", OR set
// HIGGSFIELD_API_KEY to the same "KEY_ID:KEY_SECRET" string.

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

// The verified-real flagship text-to-image model_id. Every generation routes
// here until additional model_ids are confirmed against the Higgsfield Models
// Gallery (cloud.higgsfield.ai).
export const DEFAULT_MODEL_ID = "higgsfield-ai/soul/standard";

// A "model" is just a Higgsfield model_id string. Kept as an exported alias so
// existing imports keep typechecking.
export type HiggsfieldModel = string;

export interface GenerationRequest {
  prompt: string;
  /** Higgsfield model_id (e.g. "higgsfield-ai/soul/standard"). Legacy short
   *  names without a "/" are normalised to DEFAULT_MODEL_ID. */
  model?: string;
  /** Accepted for caller compatibility but not currently forwarded — see the
   *  note in createGeneration(). */
  reference_image_url?: string;
  reference_image_base64?: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  resolution?: "720p" | "1080p" | "1k" | "2k";
}

export interface GenerationResult {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  image_url?: string;
  error?: string;
}

function resolveCredentials(): string {
  const creds = process.env.HIGGSFIELD_CREDENTIALS?.trim();
  if (creds && creds.includes(":")) return creds;

  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  const secret = process.env.HIGGSFIELD_API_SECRET?.trim();
  if (key && secret) return `${key}:${secret}`;
  if (key && key.includes(":")) return key;

  throw new Error(
    "Higgsfield credentials not configured. Set HIGGSFIELD_API_KEY and " +
      "HIGGSFIELD_API_SECRET (or HIGGSFIELD_CREDENTIALS=KEY_ID:KEY_SECRET) " +
      "in your environment. Find these in your Higgsfield dashboard at " +
      "cloud.higgsfield.ai.",
  );
}

async function higgsfieldFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const credentials = resolveCredentials();
  return fetch(`${HIGGSFIELD_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Key ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "higgsfield-pipeline-app/1.0",
      ...(options.headers ?? {}),
    },
  });
}

// A real model_id is a path like "org/model/tier". Anything without a slash is
// a legacy short name the platform does not recognise — fall back to the
// verified default rather than 404.
function normalizeModelId(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return DEFAULT_MODEL_ID;
  return trimmed.includes("/") ? trimmed : DEFAULT_MODEL_ID;
}

// 720p is the only resolution confirmed working for the default model_id in
// the Higgsfield docs, so it is the safe default. 1080p is emitted only when a
// caller explicitly asks for it (and accepts the risk the model rejects it).
function normalizeResolution(res?: string): "720p" | "1080p" {
  return res === "1080p" ? "1080p" : "720p";
}

// Pull the result image URL out of the shapes Higgsfield returns it in.
function extractImageUrl(data: Record<string, unknown>): string | undefined {
  const images = data.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return images[0].url;
  return (
    (data.image_url as string | undefined) ??
    (data.url as string | undefined) ??
    ((data.result as { url?: string } | undefined)?.url)
  );
}

export async function createGeneration(
  req: GenerationRequest,
): Promise<GenerationResult> {
  const modelId = normalizeModelId(req.model);
  const aspect = req.aspect_ratio ?? "1:1";
  const resolution = normalizeResolution(req.resolution);

  // NOTE: reference_image_url / reference_image_base64 are intentionally not
  // forwarded. The documented text-to-image body is only { prompt, aspect_ratio,
  // resolution }; the per-model input-image field is undocumented and sending
  // an unknown field risks an HTTP 422. The Stage 3 prompts already describe
  // the product in detail, so generation still works without it.
  const body = {
    prompt: req.prompt,
    aspect_ratio: aspect,
    resolution,
  };

  const res = await higgsfieldFetch(`/${modelId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const friendly =
      res.status === 401
        ? "Higgsfield rejected the credentials. Verify HIGGSFIELD_API_KEY/HIGGSFIELD_API_SECRET in your environment (regenerate them at cloud.higgsfield.ai if needed)."
        : res.status === 403
          ? "Higgsfield credit balance is empty or your plan does not include this model."
          : res.status === 404
            ? `Higgsfield model "${modelId}" not found. Verify the model_id against the Models Gallery at cloud.higgsfield.ai.`
            : res.status === 422
              ? `Higgsfield validation error: ${text.slice(0, 300)}`
              : `Higgsfield API error ${res.status}: ${text.slice(0, 300)}`;
    throw new Error(friendly);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const requestId =
    (data.request_id as string | undefined) ?? (data.id as string | undefined);
  const status = (data.status as GenerationResult["status"]) ?? "queued";
  const inlineUrl = extractImageUrl(data);

  // Some responses may already be complete on submit.
  if (status === "completed" && inlineUrl) {
    return { id: requestId ?? "sync", status, image_url: inlineUrl };
  }

  if (!requestId) {
    throw new Error(
      `Higgsfield returned no request_id. Raw response: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  return { id: requestId, status };
}

export async function pollGeneration(id: string): Promise<GenerationResult> {
  const res = await higgsfieldFetch(`/requests/${id}/status`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield poll error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const status = (data.status as GenerationResult["status"]) ?? "in_progress";

  return {
    id,
    status,
    image_url: extractImageUrl(data),
    error: (data.error as string | undefined) ?? (data.detail as string | undefined),
  };
}

export async function generateImage(req: GenerationRequest): Promise<string> {
  let result = await createGeneration(req);

  if (result.status === "completed" && result.image_url) {
    return result.image_url;
  }

  if (!result.id || result.id === "sync") {
    throw new Error("Higgsfield returned no request_id; cannot poll for result.");
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    result = await pollGeneration(result.id);

    if (result.status === "completed" && result.image_url) return result.image_url;
    if (result.status === "failed") {
      throw new Error(`Higgsfield generation failed: ${result.error ?? "unknown error"}`);
    }
    if (result.status === "nsfw") {
      throw new Error("Higgsfield flagged the prompt as NSFW and refused to generate.");
    }
  }

  throw new Error(`Higgsfield generation timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`);
}
