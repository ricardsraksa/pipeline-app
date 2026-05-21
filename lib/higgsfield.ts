// Higgsfield platform API connector.
//
// Verified live against platform.higgsfield.ai + the Models Gallery
// (cloud.higgsfield.ai):
//   Base URL : https://platform.higgsfield.ai
//   Submit   : POST /{model_id}
//   Poll     : GET  /requests/{request_id}/status
//   Auth     : Authorization: Key {KEY_ID}:{KEY_SECRET}
//
// Base model is Soul Reference — Higgsfield's flagship model that conditions
// generation on a product photo (`image_reference_url`, required). When a run
// has no reference image, generation falls back to Soul Standard (text-only).
//
// NOTE: Nano Banana Pro is NOT exposed on the Higgsfield REST API — the REST
// catalog is only the Soul family + DoP video models. It is reachable via the
// Higgsfield consumer app / MCP, neither of which a deployed server can call.
// If it ever lands on REST, swap BASE_MODEL below.
//
// Credentials: set HIGGSFIELD_API_KEY (key id) and HIGGSFIELD_API_SECRET, OR
// set HIGGSFIELD_CREDENTIALS in the format "KEY_ID:KEY_SECRET".

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

// Verified-real model_ids (path segments for POST /{model_id}).
export const BASE_MODEL = "higgsfield-ai/soul/reference"; // text + required reference image
export const FALLBACK_MODEL = "higgsfield-ai/soul/standard"; // text-only, no reference image

// Kept as a loose alias so any lingering imports keep typechecking.
export type HiggsfieldModel = string;

export interface GenerationRequest {
  prompt: string;
  /** Accepted for caller compatibility; model routing is decided by whether a
   *  reference image is present, not by this field. */
  model?: string;
  /** Product photo URL. When set, generation uses Soul Reference and the image
   *  conditions the result. Must be an https URL. */
  reference_image_url?: string;
  /** Accepted for caller compatibility but unused — Soul Reference needs a URL,
   *  not base64. Callers should pass an https URL via reference_image_url. */
  reference_image_base64?: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:3" | "3:2";
  resolution?: "720p" | "1080p" | "1k" | "2k";
}

export interface GenerationResult {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
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
    "Higgsfield credentials not configured. Set HIGGSFIELD_API_KEY (key id) and " +
      "HIGGSFIELD_API_SECRET (or HIGGSFIELD_CREDENTIALS=KEY_ID:KEY_SECRET) in your " +
      "environment. Create an API key at cloud.higgsfield.ai/api-keys.",
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

// Soul models accept this fixed set of aspect ratios.
const VALID_ASPECT_RATIOS = new Set(["9:16", "16:9", "4:3", "3:4", "1:1", "2:3", "3:2"]);
function normalizeAspectRatio(a?: string): string {
  return a && VALID_ASPECT_RATIOS.has(a) ? a : "1:1";
}

// Soul resolution enum is 720p | 1080p. Default to 1080p for best quality;
// only drop to 720p when a caller explicitly asks for the lower tier.
function normalizeResolution(res?: string): "720p" | "1080p" {
  return res === "720p" || res === "1k" ? "720p" : "1080p";
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
  const aspect = normalizeAspectRatio(req.aspect_ratio);
  const resolution = normalizeResolution(req.resolution);
  const referenceUrl = req.reference_image_url?.trim();

  // Soul Reference is the base model — it conditions on a product photo. With
  // no reference image, fall back to Soul Standard (text-only).
  const useReference = Boolean(referenceUrl);
  const modelId = useReference ? BASE_MODEL : FALLBACK_MODEL;

  const body: Record<string, unknown> = useReference
    ? {
        prompt: req.prompt,
        image_reference_url: referenceUrl,
        aspect_ratio: aspect,
        resolution,
        batch_size: 1,
        enhance_prompt: true,
      }
    : {
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
        ? "Higgsfield rejected the credentials. Verify HIGGSFIELD_API_KEY/HIGGSFIELD_API_SECRET (create a fresh key at cloud.higgsfield.ai/api-keys)."
        : res.status === 403
          ? "Higgsfield account is out of credits. Add credits at cloud.higgsfield.ai/credits, then retry."
          : res.status === 404
            ? `Higgsfield model "${modelId}" not found.`
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
    if (result.status === "canceled") {
      throw new Error("Higgsfield generation was canceled.");
    }
  }

  throw new Error(`Higgsfield generation timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`);
}
