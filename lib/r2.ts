// Cloudflare R2 uploads, shared by the source-image upload route, the scraper
// image import and the Higgsfield PNG shim. Every image that lands in the
// PUBLIC bucket goes through uploadImageBuffer, which sniffs the real format
// with sharp — a file served from our origin as image/svg+xml or text/html
// would be an XSS/phishing surface, so the client-declared type is ignored.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

interface R2Config {
  client: S3Client;
  bucket: string;
  publicBase: string;
}

let cached: R2Config | null | undefined;

export function r2Config(): R2Config | null {
  if (cached !== undefined) return cached;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    cached = null;
    return null;
  }
  cached = {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicBase: publicUrl.replace(/\/$/, ""),
  };
  return cached;
}

export function r2Configured(): boolean {
  return r2Config() !== null;
}

// sharp's detected container → stored MIME + extension. Anything else is not
// an image we accept, whatever the bytes were labelled.
const SNIFFED: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  gif: { mime: "image/gif", ext: "gif" },
  avif: { mime: "image/avif", ext: "avif" },
  heif: { mime: "image/heic", ext: "heic" },
};

const TRANSCODE = new Set(["image/avif", "image/heic"]);

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "image";
}

/**
 * Upload an image to R2 under an unguessable key and return its public URL.
 * Throws when the bytes are not a supported image. AVIF/HEIC are transcoded
 * to JPEG so every stored image is one the vision APIs accept.
 */
export async function uploadImageBuffer(
  buf: Buffer,
  opts: { prefix: string; name?: string },
): Promise<{ url: string; key: string; contentType: string }> {
  const cfg = r2Config();
  if (!cfg) throw new Error("R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.");

  let format: string | undefined;
  try {
    format = (await sharp(buf, { failOn: "none", limitInputPixels: 80_000_000 }).metadata()).format;
  } catch { format = undefined; }
  const sniffed = format ? SNIFFED[format] : undefined;
  if (!sniffed) throw new Error(`${opts.name ?? "file"} is not a supported image (JPEG, PNG, WebP, GIF, AVIF, or HEIC).`);

  let body = buf;
  let { mime, ext } = sniffed;
  if (TRANSCODE.has(mime)) {
    body = await sharp(buf, { failOn: "none" }).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    mime = "image/jpeg";
    ext = "jpg";
  }

  const base = sanitizeName((opts.name ?? "image").replace(/\.[^.]+$/, ""));
  const prefix = opts.prefix.replace(/^\/+|\/+$/g, "");
  const key = `${prefix}/${randomUUID()}-${base}.${ext}`;
  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { url: `${cfg.publicBase}/${key}`, key, contentType: mime };
}
