import { NextRequest } from "next/server";
import axios from "axios";

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return Response.json({ success: false, error: "URL required" }, { status: 400 });

  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
    });

    const html: string = res.data;

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";

    const descriptionMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const description = descriptionMatch?.[1]?.trim() ?? "";

    const ogImageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const ogImage = ogImageMatch?.[1] ?? null;

    const imageUrls: string[] = [];
    if (ogImage) imageUrls.push(ogImage);

    const imgRegex = /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (
        src &&
        !src.startsWith("data:") &&
        (src.includes("cdn") || src.includes("img") || src.includes("image") || src.includes("photo")) &&
        (src.endsWith(".jpg") || src.endsWith(".jpeg") || src.endsWith(".png") || src.endsWith(".webp") || src.includes(".jpg?") || src.includes(".png?"))
      ) {
        const normalised = src.startsWith("//") ? `https:${src}` : src;
        if (!imageUrls.includes(normalised)) imageUrls.push(normalised);
      }
      if (imageUrls.length >= 8) break;
    }

    const scraped_text = [title, description]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);

    return Response.json({
      success: true,
      scraped_text,
      images: imageUrls.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message });
  }
}
