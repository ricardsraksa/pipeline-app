import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

// Upload user-provided source images to Cloudflare R2.
// Requires env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET_NAME, R2_PUBLIC_URL (the public bucket URL, e.g.
// https://pub-xxxxx.r2.dev).

const MAX_FILES = 10;
const MAX_SIZE_PER_FILE = 8 * 1024 * 1024; // 8MB

// Anthropic's vision API supports only these MIME types.
const ANTHROPIC_SAFE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// We transcode these to JPEG on the server so the user doesn't have to care.
// AVIF/HEIC are common on modern phones and Apple Photos exports.
const TRANSCODE_MIME = new Set(["image/avif", "image/heic", "image/heif"]);

// Anything image/* that's neither directly supported nor transcodable.
const ACCEPTED_LABEL = "JPEG, PNG, WebP, GIF, AVIF, or HEIC";

function getS3Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in env."
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "image";
}

function extFor(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("avif")) return "avif";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "jpg";
}

interface PreparedUpload {
  body: Buffer;
  contentType: string;
  ext: string;
}

async function prepareForR2(file: File): Promise<PreparedUpload> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type.toLowerCase();

  if (TRANSCODE_MIME.has(mime)) {
    // Transcode → JPEG. sharp auto-rotates based on EXIF orientation.
    const jpeg = await sharp(buf, { failOn: "none" })
      .rotate()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { body: jpeg, contentType: "image/jpeg", ext: "jpg" };
  }

  return { body: buf, contentType: file.type, ext: extFor(mime) };
}

export async function POST(req: NextRequest) {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    return NextResponse.json(
      { error: "R2 not configured: missing R2_BUCKET_NAME or R2_PUBLIC_URL." },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart payload" }, { status: 400 });
  }

  const files = formData.getAll("images").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Max ${MAX_FILES} images` }, { status: 400 });
  }
  for (const f of files) {
    if (f.size > MAX_SIZE_PER_FILE) {
      return NextResponse.json(
        { error: `${f.name} exceeds 8MB limit` },
        { status: 400 }
      );
    }
    if (!f.type.startsWith("image/")) {
      return NextResponse.json(
        { error: `${f.name} is not an image (${f.type})` },
        { status: 400 }
      );
    }
    const mime = f.type.toLowerCase();
    if (!ANTHROPIC_SAFE_MIME.has(mime) && !TRANSCODE_MIME.has(mime)) {
      return NextResponse.json(
        {
          error: `${f.name} is ${f.type || "an unsupported format"}. Accepted: ${ACCEPTED_LABEL}.`,
        },
        { status: 400 }
      );
    }
  }

  let s3: S3Client;
  try {
    s3 = getS3Client();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "R2 client init failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const trimmedPublicUrl = publicUrl.replace(/\/$/, "");
  const uploadedUrls: string[] = [];
  try {
    for (const file of files) {
      const { body, contentType, ext } = await prepareForR2(file);
      const base = sanitizeName(file.name.replace(/\.[^.]+$/, ""));
      const key = `source/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}.${ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
      uploadedUrls.push(`${trimmedPublicUrl}/${key}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ urls: uploadedUrls });
}
