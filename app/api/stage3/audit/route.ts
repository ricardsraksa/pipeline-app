import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { auditImage } from "@/lib/stage3/audit";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { image_url, category, prompt_used, product_description, overlay_text_used, run_id, reference_urls } = await req.json();
  if (!image_url || !category || !prompt_used) {
    return Response.json({ success: false, error: "image_url, category, prompt_used required" }, { status: 400 });
  }
  try {
    const result = await auditImage({
      image_url: String(image_url), category: String(category), prompt_used: String(prompt_used),
      product_description: product_description ?? "", overlay_text_used: overlay_text_used ?? null,
      reference_urls: Array.isArray(reference_urls) ? reference_urls : [],
      run_id: typeof run_id === "number" ? run_id : null,
    });
    return Response.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = /blocked|private|not allowed|must be https/i.test(message);
    return Response.json({ success: false, error: message }, { status: blocked ? 400 : 500 });
  }
}
