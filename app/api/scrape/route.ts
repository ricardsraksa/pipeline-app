import { NextRequest } from "next/server";
import axios from "axios";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return Response.json({ success: false, error: "URL required" }, { status: 400 });

  // Preferred path: dedicated Python scraper service (Playwright-based)
  const scraperServiceUrl = process.env.SCRAPER_SERVICE_URL;
  if (scraperServiceUrl) {
    try {
      const svcRes = await axios.post(
        `${scraperServiceUrl.replace(/\/$/, "")}/scrape`,
        { url },
        { timeout: 300000, headers: { "Content-Type": "application/json" } },
      );
      const body = svcRes.data ?? {};
      if (body.success) {
        return Response.json({
          success: true,
          scraped_text: body.scraped_text ?? "",
          images: body.images ?? [],
          title: body.title ?? "",
          description: body.description ?? "",
          specs: body.specs ?? {},
          platform: body.platform ?? "",
        });
      }
      // If the service returned success=false, fall through to legacy fallback below
      console.warn("scraper service returned failure, falling back:", body.error);
    } catch (err) {
      console.warn("scraper service call failed, falling back:", err instanceof Error ? err.message : err);
      // fall through to legacy fallback
    }
  }

  try {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;

    let html: string;

    if (firecrawlKey) {
      const fcRes = await axios.post(
        "https://api.firecrawl.dev/v1/scrape",
        { url, formats: ["html"] },
        {
          timeout: 60000,
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      html = fcRes.data?.data?.html ?? "";
    } else {
      // Random delay 2-5s to avoid bot-detection rate limits
      await sleep(Math.random() * 3000 + 2000);

      const res = await axios.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent": randomUA(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        maxRedirects: 5,
      });
      html = res.data;
    }

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
