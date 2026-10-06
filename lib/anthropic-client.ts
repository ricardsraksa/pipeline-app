// The one way the app makes an Anthropic client.
//
// Photos used to go to the model as links ({type:"url"}), which makes
// Anthropic's servers download them. When that download times out the whole
// call fails with a 400 — run 176's product description failed twice on
// small photos in our own R2 bucket that load in under a second from here
// ("The request timed out while trying to download the file"). So every
// request is checked on its way out: linked images are downloaded by the app
// and sent inline. A photo the app can't fetch either is replaced by a short
// note instead of failing the call.
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import sharp from "sharp";
import { assertPublicUrl } from "@/lib/ssrf";

type Inline = { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
// API limits: 5 MB per image (base64 counts), 8000 px per side.
const MAX_BYTES = 3_600_000;
const MAX_SIDE = 7900;
const DOWNLOAD_CAP = 40_000_000;

// The same photos go to many calls in a row (an audit per image, each with
// the same references), so keep recent downloads.
const cache = new Map<string, Promise<Inline | null>>();
const CACHE_MAX = 60;

async function fetchPublic(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const r = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location")!, current).href;
      continue;
    }
    return r.ok ? r : null;
  }
  return null;
}

async function download(url: string): Promise<Inline | null> {
  try {
    const r = await fetchPublic(url);
    if (!r) return null;
    let buf: Buffer = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > DOWNLOAD_CAP) return null;
    let type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    const wrongType = !ALLOWED.has(type) || (meta.format && !["jpeg", "png", "gif", "webp"].includes(meta.format));
    if (wrongType || buf.length > MAX_BYTES || w > MAX_SIDE || h > MAX_SIDE) {
      // Re-encode as JPEG within the limits, keeping as much detail as fits:
      // tall description images carry spec text, so shrink only as needed.
      let side = Math.min(Math.max(w, h) || MAX_SIDE, MAX_SIDE);
      for (let i = 0; i < 6; i++) {
        buf = await sharp(buf).rotate().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        if (buf.length <= MAX_BYTES) break;
        side = Math.round(side * 0.7);
      }
      if (buf.length > MAX_BYTES) return null;
      type = "image/jpeg";
    }
    return { media_type: type as Inline["media_type"], data: buf.toString("base64") };
  } catch {
    return null;
  }
}

function inlineImage(url: string): Promise<Inline | null> {
  let p = cache.get(url);
  if (!p) {
    p = download(url);
    cache.set(url, p);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    // A failure isn't remembered: the next call tries again.
    void p.then((v) => { if (!v) cache.delete(url); });
  }
  return p;
}

type Block = { type?: string; source?: { type?: string; url?: string }; content?: unknown };

/** Swap every linked image in a request's messages for inline data. */
export async function inlineUrlImages(messages: unknown): Promise<boolean> {
  if (!Array.isArray(messages)) return false;
  const jobs: Array<Promise<void>> = [];
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    list.forEach((b: Block, i) => {
      if (b?.type === "image" && b.source?.type === "url" && typeof b.source.url === "string") {
        const url = b.source.url;
        jobs.push(inlineImage(url).then((img) => {
          list[i] = img
            ? { ...b, source: { type: "base64", media_type: img.media_type, data: img.data } }
            : { type: "text", text: `[An image could not be loaded: ${url}]` };
        }));
      } else if (b?.type === "tool_result") {
        visit(b.content);
      }
    });
  };
  for (const m of messages as Array<{ content?: unknown }>) visit(m?.content);
  await Promise.all(jobs);
  return jobs.length > 0;
}

const visionFetch: typeof fetch = async (input, init) => {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    if (typeof body === "string" && /\/v1\/messages(\/count_tokens)?(\?|$)/.test(url) && body.includes('"url"')) {
      const json = JSON.parse(body) as { messages?: unknown };
      if (await inlineUrlImages(json.messages)) {
        const headers = new Headers(init!.headers);
        headers.delete("content-length");
        init = { ...init, body: JSON.stringify(json), headers };
      }
    }
  } catch (e) {
    console.error("[anthropic] could not inline images, sending as is:", e);
  }
  return fetch(input, init);
};

/** An Anthropic client that never asks the API to download a photo. */
export function anthropicClient(opts: ClientOptions = {}): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...opts, fetch: visionFetch });
}
