const HIGGSFIELD_BASE = "https://api.higgsfield.ai";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

export type HiggsfieldModel =
  | "marketing_studio_image"
  | "flux_2"
  | "nano_banana_flash"
  | "nano_banana_2";

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
  status: "pending" | "processing" | "completed" | "failed";
  image_url?: string;
  error?: string;
}

async function higgsfieldFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) throw new Error("HIGGSFIELD_API_KEY is not set");

  return fetch(`${HIGGSFIELD_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export async function createGeneration(
  req: GenerationRequest
): Promise<GenerationResult> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    model: req.model ?? "marketing_studio_image",
    aspect_ratio: req.aspect_ratio ?? "1:1",
    resolution: req.resolution ?? "2k",
  };

  if (req.model_variant) body.variant = req.model_variant;
  if (req.reference_image_url) body.reference_image_url = req.reference_image_url;
  if (req.reference_image_base64) body.reference_image = req.reference_image_base64;

  const res = await higgsfieldFetch("/v1/generation", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (data.image_url || data.url) {
    return {
      id: data.id ?? "sync",
      status: "completed",
      image_url: data.image_url ?? data.url,
    };
  }

  return {
    id: data.id ?? data.job_id ?? data.generation_id,
    status: data.status ?? "pending",
  };
}

export async function pollGeneration(id: string): Promise<GenerationResult> {
  const res = await higgsfieldFetch(`/v1/generation/${id}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield poll error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    id,
    status: data.status ?? "processing",
    image_url: data.image_url ?? data.url,
    error: data.error,
  };
}

export async function generateImage(
  req: GenerationRequest
): Promise<string> {
  let result = await createGeneration(req);

  if (result.status === "completed" && result.image_url) {
    return result.image_url;
  }

  if (!result.id || result.id === "sync") {
    throw new Error("Generation failed: no job ID returned");
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    result = await pollGeneration(result.id);

    if (result.status === "completed" && result.image_url) {
      return result.image_url;
    }
    if (result.status === "failed") {
      throw new Error(`Generation failed: ${result.error ?? "unknown error"}`);
    }
  }

  throw new Error("Generation timed out after 120 seconds");
}
