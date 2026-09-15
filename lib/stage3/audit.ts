import Anthropic from "@anthropic-ai/sdk";
import { IMAGE_AUDIT_SYSTEM, buildAuditUserMessage } from "@/lib/prompts/image_audit";
import { getModel } from "@/lib/models";
import { recordUsage } from "@/lib/db";
import { assertPublicUrl } from "@/lib/ssrf";

// The image auditor, callable from routes and from the server-side batches.
// timeout: a hung vision call (usually Anthropic struggling to download the
// image URL) fails in 90s instead of the SDK's 10-min default.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

export interface AuditArgs {
  image_url: string;
  category: string;
  prompt_used: string;
  product_description?: string | null;
  overlay_text_used?: string | null;
  /** The reference photos the image was generated from (fidelity check). */
  reference_urls?: string[];
  run_id?: number | null;
}
export interface AuditResult { verdict: "pass" | "fail"; issues: string[]; requires_regeneration?: boolean }

// Anthropic occasionally fails transiently fetching the image URL ("timed out
// while trying to download the file") — retry before giving up so a blip
// doesn't mislabel an image.
async function createWithRetry(body: Anthropic.MessageCreateParamsNonStreaming) {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await anthropic.messages.stream(body).finalMessage();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      const transient =
        status === 429 ||
        (typeof status === "number" && status >= 500) ||
        (typeof status !== "number" && /timeout|timed out|overloaded|econnreset|socket|network|fetch failed/i.test(msg));
      if (!transient) throw err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Throws on a blocked URL, a model failure or unparseable output. */
export async function auditImage(args: AuditArgs): Promise<AuditResult> {
  const refs = (args.reference_urls ?? []).filter((u) => typeof u === "string" && u.startsWith("https://")).slice(0, 4);
  await assertPublicUrl(String(args.image_url));
  for (const u of refs) await assertPublicUrl(u);

  const userMessage = buildAuditUserMessage({
    category: args.category,
    prompt_used: args.prompt_used,
    product_description: args.product_description ?? "",
    overlay_text_used: args.overlay_text_used ?? null,
    reference_count: refs.length,
  });
  const model = await getModel("stage3Audit");
  const message = await createWithRetry({
    model,
    max_tokens: 8000,
    // No cache_control: at ~590 tokens the auditor prompt is below the model's
    // 1024-token minimum cacheable prefix, so a cache marker here never caches.
    system: IMAGE_AUDIT_SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: args.image_url } },
        ...refs.map((u) => ({ type: "image" as const, source: { type: "url" as const, url: u } })),
        { type: "text", text: userMessage },
      ],
    }],
  });
  void recordUsage(typeof args.run_id === "number" ? args.run_id : null, "stage3: image audit", model, message.usage);
  const raw = message.content.find((b) => b.type === "text")?.text ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse audit JSON");
  const parsed = JSON.parse(jsonMatch[0]) as { verdict?: unknown; issues?: unknown; requires_regeneration?: unknown };
  return {
    verdict: parsed.verdict === "pass" ? "pass" : "fail",
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter((x): x is string => typeof x === "string") : [],
    requires_regeneration: parsed.requires_regeneration === true,
  };
}
