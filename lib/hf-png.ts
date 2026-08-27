// Higgsfield reference-image PNG normalizer.
//
// As of 2026-08-19 Higgsfield's media_import_url is broken for any source that
// is not a PNG. It allocates a destination key ending in ".png" and signs the
// presigned S3 PUT for content-type image/png, but then uploads using the
// SOURCE's content type — so S3 rejects the upload:
//
//   403 SignatureDoesNotMatch
//   CanonicalRequest: PUT /user_.../<uuid>.png ... content-type:image/jpeg
//
// Our product photos land in R2 as JPEGs, so every hero generation failed while
// the 8-image step (whose reference is Higgsfield's own PNG hero) kept working.
// Verified directly against their MCP: the same .jpg URL 403s, a .png URL
// imports fine.
//
// Workaround: transcode non-PNG references to PNG, park them in R2, and hand
// Higgsfield the PNG URL. The converted object is keyed by a hash of the source
// URL, so repeat runs reuse it instead of re-uploading. Remove this module once
// Higgsfield signs with the content type it actually sends.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import http from "node:http";
import https from "node:https";
import { assertPublicUrl, ssrfAgentOptions } from "@/lib/ssrf";
import { createHash } from "crypto";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

// Source URL → converted PNG URL, for the lifetime of the process.
const converted = new Map<string, string>();

function isPngUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".png");
  } catch {
    return false;
  }
}

interface R2Config {
  client: S3Client;
  bucket: string;
  publicBase: string;
}

function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicBase: publicUrl.replace(/\/$/, ""),
  };
}

/**
 * Return a URL for `url` that Higgsfield's importer can actually ingest: the
 * original when it is already a PNG, otherwise a PNG copy hosted in R2.
 *
 * Best-effort — if R2 is unconfigured, the fetch fails, or sharp cannot decode
 * the image, the original URL is returned so the caller is never worse off than
 * before this workaround existed.
 *
 * @param force convert even when the URL looks like a PNG (used to retry a URL
 *              whose extension lied about its real content type).
 */
export async function ensurePngUrl(url: string, force = false): Promise<string> {
  if (!force && isPngUrl(url)) return url;

  const cached = converted.get(url);
  if (cached) return cached;

  const cfg = r2Config();
  if (!cfg) return url;

  try {
    // SSRF guard: this URL is caller-influenced and the fetched bytes land in
    // public R2 — reject private targets up front AND at every socket connect
    // (the agent-level lookup covers redirects and DNS rebinding).
    try {
      await assertPublicUrl(url);
    } catch (e) {
      console.warn("[hf-png] blocked reference URL:", url, e instanceof Error ? e.message : e);
      return url;
    }
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30_000,
      maxRedirects: 5,
      maxContentLength: MAX_SOURCE_BYTES,
      httpAgent: new http.Agent(ssrfAgentOptions),
      httpsAgent: new https.Agent(ssrfAgentOptions),
    });

    const source = Buffer.from(res.data);
    if (!source.length || source.length > MAX_SOURCE_BYTES) return url;

    // Already a PNG despite the extension — nothing to do.
    if (!force && source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return url;
    }

    // rotate() bakes in EXIF orientation, which PNG cannot carry.
    const png = await sharp(source, { failOn: "none" }).rotate().png().toBuffer();

    const key = `hf-png/${createHash("sha1").update(url).digest("hex")}.png`;
    await cfg.client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: png,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const pngUrl = `${cfg.publicBase}/${key}`;
    converted.set(url, pngUrl);
    return pngUrl;
  } catch {
    return url;
  }
}
