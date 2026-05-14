import { NextRequest } from "next/server";
import { generateImage } from "@/lib/higgsfield";
import type { ImagePrompt } from "@/app/api/stage3-prompts/route";

export async function POST(req: NextRequest) {
  const { prompt_obj, images } = await req.json() as {
    prompt_obj: ImagePrompt;
    images: string[];
  };

  if (!prompt_obj) {
    return Response.json({ success: false, error: "prompt_obj required" }, { status: 400 });
  }

  const refKey = prompt_obj.reference_image;
  let referenceUrl: string | undefined;
  let referenceBase64: string | undefined;

  if (refKey && refKey !== "none" && images?.length) {
    const idx = parseInt(refKey.replace("image_", ""), 10) - 1;
    const ref = images[idx];
    if (ref) {
      if (ref.startsWith("data:")) {
        referenceBase64 = ref.split(",")[1];
      } else if (ref.startsWith("http")) {
        referenceUrl = ref;
      }
    }
  }

  const model =
    prompt_obj.category === "INFOGRAPHIC"
      ? ("nano_banana_2" as const)
      : ("marketing_studio_image" as const);

  try {
    const image_url = await generateImage({
      prompt: prompt_obj.prompt,
      model,
      reference_image_url: referenceUrl,
      reference_image_base64: referenceBase64,
      aspect_ratio: "1:1",
      resolution: "2k",
    });

    return Response.json({ success: true, image_url, index: prompt_obj.index });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { success: false, error: message, index: prompt_obj.index },
      { status: 500 }
    );
  }
}
