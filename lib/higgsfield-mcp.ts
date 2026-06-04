// Higgsfield MCP client.
//
// The Higgsfield REST API (platform.higgsfield.ai) does NOT expose Nano Banana
// Pro — only the Soul family + DoP video. The Higgsfield MCP server
// (mcp.higgsfield.ai/mcp) DOES. This module makes the app a direct MCP /
// JSON-RPC client of that server, so Stage 3 can generate with nano_banana_pro.
//
// Auth: OAuth 2.1. The one-time authorization-code + PKCE flow is done out of
// band; this module only performs the refresh_token grant. Refresh tokens
// ROTATE — every refresh returns a new one — so the current refresh token is
// persisted to the app_kv table. It is seeded from HIGGSFIELD_MCP_REFRESH_TOKEN
// on first use; after that the DB copy is the source of truth.
//
// Env: HIGGSFIELD_MCP_CLIENT_ID, HIGGSFIELD_MCP_REFRESH_TOKEN (seed).

import { getKV, setKV } from "./db";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";

const KV_REFRESH = "higgsfield_mcp_refresh_token";
const KV_ACCESS = "higgsfield_mcp_access_token";
const KV_ACCESS_EXP = "higgsfield_mcp_access_expiry"; // epoch ms, as string

const GENERATION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3000;

function clientId(): string {
  const id = process.env.HIGGSFIELD_MCP_CLIENT_ID?.trim();
  if (!id) throw new Error("HIGGSFIELD_MCP_CLIENT_ID is not set.");
  return id;
}

// ── OAuth token management ───────────────────────────────────────────────────

let memAccess: { token: string; expiresAt: number } | null = null;
let refreshInFlight: Promise<string> | null = null;

async function currentRefreshToken(): Promise<string> {
  const stored = await getKV(KV_REFRESH);
  if (stored) return stored;
  const seed = process.env.HIGGSFIELD_MCP_REFRESH_TOKEN?.trim();
  if (seed) return seed;
  throw new Error(
    "No Higgsfield MCP refresh token available. Seed HIGGSFIELD_MCP_REFRESH_TOKEN " +
      "or re-run the OAuth authorization flow.",
  );
}

async function doRefresh(): Promise<string> {
  const refreshToken = await currentRefreshToken();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Higgsfield MCP token refresh failed (${res.status}): ${text.slice(0, 200)}. ` +
        "The refresh token may have expired — re-run the OAuth flow.",
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) {
    throw new Error("Higgsfield MCP token refresh returned no access_token.");
  }
  // Refresh tokens rotate — persist the new one immediately so it isn't lost.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await setKV(KV_REFRESH, data.refresh_token);
  }
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  memAccess = { token: data.access_token, expiresAt };
  await setKV(KV_ACCESS, data.access_token);
  await setKV(KV_ACCESS_EXP, String(expiresAt));
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  const margin = 60_000;
  if (memAccess && memAccess.expiresAt - margin > Date.now()) return memAccess.token;

  // Cross-process / cold-start path: a sibling instance may have a live token.
  const kvTok = await getKV(KV_ACCESS);
  const kvExp = Number((await getKV(KV_ACCESS_EXP)) ?? 0);
  if (kvTok && kvExp - margin > Date.now()) {
    memAccess = { token: kvTok, expiresAt: kvExp };
    return kvTok;
  }

  // Refresh — single-flight so concurrent callers don't race the rotating token.
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ── MCP JSON-RPC transport ───────────────────────────────────────────────────

interface JsonRpcResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

// The MCP server replies with text/event-stream; the JSON-RPC payload is on the
// last `data:` line.
function parseSse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const raw = dataLines.length ? dataLines[dataLines.length - 1] : body.trim();
  return JSON.parse(raw) as JsonRpcResponse;
}

let rpcId = 1;

// Higgsfield's MCP sits behind Cloudflare and intermittently returns 502/503/
// 504 (origin bad gateway) or 429. These are transient — retry a few times
// with exponential backoff before surfacing the failure to the user.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mcpRequest(
  method: string,
  params: unknown,
  allowRetry = true,
): Promise<unknown> {
  const maxAttempts = 4;
  let lastTransient: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken();
    let res: Response;
    try {
      res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
      });
    } catch (err) {
      // Network-level failure (DNS, reset, timeout) — treat as transient.
      lastTransient = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts - 1) { await sleep(700 * 2 ** attempt); continue; }
      throw new Error(`Higgsfield MCP ${method} network error after ${maxAttempts} attempts: ${lastTransient}`);
    }

    if (res.status === 401 && allowRetry) {
      // Access token rejected — force a refresh and retry once.
      memAccess = null;
      await setKV(KV_ACCESS_EXP, "0");
      return mcpRequest(method, params, false);
    }

    // Transient upstream error — back off and retry without consuming the
    // 401 retry budget.
    if (TRANSIENT_STATUS.has(res.status) && attempt < maxAttempts - 1) {
      lastTransient = `${res.status}`;
      await sleep(700 * 2 ** attempt);
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Higgsfield MCP ${method} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const parsed = parseSse(text);
    if (parsed.error) {
      throw new Error(`Higgsfield MCP ${method} error: ${parsed.error.message}`);
    }
    return parsed.result;
  }

  throw new Error(`Higgsfield MCP ${method} failed after ${maxAttempts} attempts (last: ${lastTransient}).`);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = (await mcpRequest("tools/call", { name, arguments: args })) as ToolResult;
  if (result?.isError) {
    const msg =
      result.content
        ?.map((c) => c.text)
        .filter(Boolean)
        .join(" ") ?? "unknown tool error";
    throw new Error(`Higgsfield ${name}: ${msg}`);
  }
  return result;
}

// ── Result parsing ───────────────────────────────────────────────────────────

// Walk the structuredContent and collect every object that carries a `status`
// field — these are the generation/job records, regardless of nesting shape.
function findStatusObjects(v: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(v)) {
    v.forEach((x) => findStatusObjects(x, out));
    return;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.status === "string") out.push(o);
    Object.values(o).forEach((x) => findStatusObjects(x, out));
  }
}

function jobIdOf(o: Record<string, unknown>): string | undefined {
  const id = o.id ?? o.job_id ?? o.jobId;
  return typeof id === "string" ? id : undefined;
}

// Completed image jobs expose results.rawUrl (full image) + results.minUrl.
function imageUrlOf(o: Record<string, unknown>): string | undefined {
  const r = (o.results ?? {}) as Record<string, unknown>;
  const raw =
    r.rawUrl ?? r.raw_url ?? (r.raw as { url?: string } | undefined)?.url;
  if (typeof raw === "string") return raw;
  if (typeof o.url === "string") return o.url;
  const min = r.minUrl ?? r.min_url;
  if (typeof min === "string") return min;
  return undefined;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface McpImageRequest {
  prompt: string;
  /** Higgsfield MCP model id. Defaults to nano_banana_pro. */
  model?: string;
  aspectRatio?: string;
  /** Product photo URLs (https). Passed as reference media. */
  referenceImageUrls?: string[];
}

/**
 * Generate one image via the Higgsfield MCP (Nano Banana Pro by default) and
 * return its URL. Submits the job, then polls job_status until terminal.
 */
export async function generateImageViaMcp(req: McpImageRequest): Promise<string> {
  const params: Record<string, unknown> = {
    model: req.model?.trim() || "nano_banana_pro",
    prompt: req.prompt,
    count: 1,
  };
  if (req.aspectRatio) params.aspect_ratio = req.aspectRatio;

  const refs = (req.referenceImageUrls ?? []).filter(
    (u) => typeof u === "string" && u.startsWith("http"),
  );
  if (refs.length) {
    params.medias = refs.map((u) => ({ value: u, role: "image" }));
  }

  const submit = await callTool("generate_image", { params });

  const submitJobs: Record<string, unknown>[] = [];
  findStatusObjects(submit.structuredContent, submitJobs);

  // Occasionally the submit response already carries a finished image.
  const alreadyDone = submitJobs.find((j) => j.status === "completed");
  if (alreadyDone) {
    const url = imageUrlOf(alreadyDone);
    if (url) return url;
  }

  const jobId = submitJobs.map(jobIdOf).find(Boolean);
  if (!jobId) {
    throw new Error(
      "Higgsfield generate_image returned no job id. Response: " +
        JSON.stringify(submit.structuredContent ?? submit.content).slice(0, 300),
    );
  }

  // Poll. job_status with sync:true blocks server-side up to ~25s per call.
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusResult = await callTool("job_status", { jobId, sync: true });
    const jobs: Record<string, unknown>[] = [];
    findStatusObjects(statusResult.structuredContent, jobs);
    const job = jobs.find((j) => jobIdOf(j) === jobId) ?? jobs[0];
    const status = job?.status;

    if (status === "completed") {
      const url = job && imageUrlOf(job);
      if (url) return url;
      throw new Error("Higgsfield job completed but no image URL was found in the result.");
    }
    if (status === "failed" || status === "nsfw" || status === "canceled") {
      throw new Error(`Higgsfield generation ${status}.`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Higgsfield generation timed out after ${Math.round(GENERATION_TIMEOUT_MS / 1000)}s.`,
  );
}
