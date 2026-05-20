// Higgsfield v1 platform API connector.
//
// Base URL is platform.higgsfield.ai (not api.higgsfield.ai, which is no longer
// reachable). Auth is `Authorization: Key {KEY_ID}:{KEY_SECRET}`. Endpoints are
// `/v1/text2image/{model}` (or `/v1/image2image/{model}` when a reference image
// is provided). The request body must wrap inputs in a `params` object. Async
// jobs return a `request_id` and are polled at `/requests/{id}/status`.
//
// Credentials: set HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET separately, OR
// set HIGGSFIELD_CREDENTIALS in the format "KEY_ID:KEY_SECRET", OR set
// HIGGSFIELD_API_KEY to the same "KEY_ID:KEY_SECRET" string.

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180_000;

export type HiggsfieldModel =
  | "marketing_studio_image"
  | "flux_2"
  | "nano_banana_flash"
  | "nano_banana_2"
  | "soul";

export interface GenerationRequest {
  prompt: string;
  model?: HiggsfieldModel;
  reference_image_url?: string;
  reference_image_base64?: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  resolution?: "1k" | "2k";
  model_variant?: string;
}

export interface GenerationResult {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "nsfw";
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
      "User-Agent": "higgsfield-pipeline-app/1.0",
      ...(options.headers ?? {}),
    },
  });
}

function aspectToWidthHeight(aspect: GenerationRequest["aspect_ratio"], res: "1k" | "2k"): string {
  const base = res === "2k" ? 2048 : 1024;
  switch (aspect) {
    case "16:9":
      return `${base}x${Math.round((base * 9) / 16)}`;
    case "9:16":
      return `${Math.round((base * 9) / 16)}x${base}`;
    case "4:3":
      return `${base}x${Math.round((base * 3) / 4)}`;
    case "3:4":
      return `${Math.round((base * 3) / 4)}x${base}`;
    case "1:1":
    default:
      return `${base}x${base}`;
  }
}

export async function createGeneration(
  req: GenerationRequest,
): Promise<GenerationResult> {
  const model = req.model ?? "marketing_studio_image";
  const hasReference = !!(req.reference_image_url || req.reference_image_base64);
  const endpoint = hasReference ? `/v1/image2image/${model}` : `/v1/text2image/${model}`;
  const resolution = req.resolution ?? "2k";
  const aspect = req.aspect_ratio ?? "1:1";

  const params: Record<string, unknown> = {
    prompt: req.prompt,
    aspect_ratio: aspect,
    width_and_height: aspectToWidthHeight(aspect, resolution),
    quality: resolution === "2k" ? "high" : "standard",
  };

  if (req.model_variant) params.variant = req.model_variant;
  if (req.reference_image_url) params.reference_image_url = req.reference_image_url;
  if (req.reference_image_base64) params.reference_image = req.reference_image_base64;

  const res = await higgsfieldFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ params }),
  });

  if (!res.ok) {
    const text = await res.text();
    const friendly =
      res.status === 401
        ? "Higgsfield rejected the credentials. Verify HIGGSFIELD_API_KEY/HIGGSFIELD_API_SECRET in your environment (regenerate them at cloud.higgsfield.ai if needed)."
        : res.status === 403
          ? "Higgsfield credit balance is empty or your plan does not include this model."
          : res.status === 422
            ? `Higgsfield validation error: ${text.slice(0, 300)}`
            : `Higgsfield API error ${res.status}: ${text.slice(0, 300)}`;
    throw new Error(friendly);
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Some models (e.g., flux fast variants) return the image inline.
  const inlineUrl =
    (data.image_url as string | undefined) ??
    (data.url as string | undefined) ??
    ((data.result as { url?: string } | undefined)?.url);

  const requestId =
    (data.request_id as string | undefined) ??
    (data.id as string | undefined) ??
    (data.job_id as string | undefined);

  if (inlineUrl) {
    return { id: requestId ?? "sync", status: "completed", image_url: inlineUrl };
  }

  if (!requestId) {
    throw new Error(
      `Higgsfield returned no job id and no image url. Raw response: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  return { id: requestId, status: (data.status as GenerationResult["status"]) ?? "pending" };
}

export async function pollGeneration(id: string): Promise<GenerationResult> {
  const res = await higgsfieldFetch(`/requests/${id}/status`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield poll error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const status = (data.status as GenerationResult["status"]) ?? "processing";

  // Locate the resulting image URL across the shapes Higgsfield returns it.
  const jobs = (data.jobs as Array<Record<string, unknown>> | undefined) ?? [];
  const firstJob = jobs[0];
  const firstJobResults = (firstJob?.results as { raw?: { url?: string } } | undefined);
  const imageUrl =
    (data.image_url as string | undefined) ??
    (data.url as string | undefined) ??
    ((data.result as { url?: string } | undefined)?.url) ??
    firstJobResults?.raw?.url;

  return {
    id,
    status,
    image_url: imageUrl,
    error: (data.error as string | undefined) ?? (data.detail as string | undefined),
  };
}

export async function generateImage(req: GenerationRequest): Promise<string> {
  let result = await createGeneration(req);

  if (result.status === "completed" && result.image_url) {
    return result.image_url;
  }

  if (!result.id || result.id === "sync") {
    throw new Error("Higgsfield returned no job id; cannot poll for result.");
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
