// Google Drive export: upload a run's final images into the product's folder.
//
// Layout (operator's existing convention):
//   <GOOGLE_DRIVE_PRODUCTS_FOLDER_ID>/          ← shared with the service account
//     P58 - Anti Theft Bag/
//       Images/    ← pipeline uploads land here
//       Videos/
//
// The product folder is found by P-code prefix (same convention as the doc
// tabs); if absent, it is created as "P58 - <Product Name>" WITH both
// subfolders. Uploads skip files whose name already exists — re-sends add
// only what's missing, nothing is ever overwritten or deleted.

import axios from "axios";
import http from "node:http";
import https from "node:https";
import { assertPublicUrl, ssrfAgentOptions } from "@/lib/ssrf";
import { googleAccessToken } from "./auth";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_PRODUCTS_FOLDER_ID?.trim());
}

function parentFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_PRODUCTS_FOLDER_ID?.trim();
  if (!id) throw new Error("GOOGLE_DRIVE_PRODUCTS_FOLDER_ID is not set.");
  return id;
}

async function driveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await googleAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      let saEmail = "(unknown)";
      try { saEmail = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email ?? saEmail; } catch { /* keep */ }
      throw new Error(`Drive API ${res.status}: share the products folder with ${saEmail} as Editor and check GOOGLE_DRIVE_PRODUCTS_FOLDER_ID. (${text.slice(0, 150)})`);
    }
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

const escQ = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function listChildren(parentId: string, extraQ = ""): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const q = encodeURIComponent(`'${escQ(parentId)}' in parents and trashed = false${extraQ}`);
  const data = await driveFetch<{ files: Array<{ id: string; name: string; mimeType: string }> }>(
    `${DRIVE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  return data.files ?? [];
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const data = await driveFetch<{ id: string }>(`${DRIVE}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return data.id;
}

export interface ProductFolders {
  productFolderId: string;
  productFolderName: string;
  imagesFolderId: string;
  createdProductFolder: boolean;
}

/** Find the product folder by P-code prefix (or exact name); create the full
 *  structure ("P58 - Name" with Images + Videos) when missing. */
export async function ensureProductFolders(productCode: string, folderNameIfCreating: string): Promise<ProductFolders> {
  const code = productCode.trim();
  if (!code) throw new Error("Set a Product code on this run first (e.g. P58) — it names the Drive folder.");

  const children = await listChildren(parentFolderId(), ` and mimeType = '${FOLDER_MIME}'`);
  const codeNorm = code.toLowerCase();
  const product = children.find((f) => {
    const n = f.name.trim().toLowerCase();
    return n === codeNorm || n.startsWith(codeNorm + " ") || n.startsWith(codeNorm + "-") || n.startsWith(codeNorm + "_")
      || n === folderNameIfCreating.trim().toLowerCase();
  });

  let createdProductFolder = false;
  let productFolderId: string;
  let productFolderName: string;
  if (product) {
    productFolderId = product.id;
    productFolderName = product.name;
  } else {
    // Created with the doc tab's exact name ("P55 - Wall Lamp") so the Drive
    // folder and the doc tab stay in lockstep.
    productFolderName = folderNameIfCreating.trim();
    productFolderId = await createFolder(productFolderName, parentFolderId());
    createdProductFolder = true;
    // Match the operator's structure from the start.
    await createFolder("Videos", productFolderId);
  }

  const sub = await listChildren(productFolderId, ` and mimeType = '${FOLDER_MIME}'`);
  let images = sub.find((f) => f.name.trim().toLowerCase() === "images");
  const imagesFolderId = images ? images.id : await createFolder("Images", productFolderId);

  return { productFolderId, productFolderName, imagesFolderId, createdProductFolder };
}

export async function existingFileNames(folderId: string): Promise<Set<string>> {
  const files = await listChildren(folderId);
  return new Set(files.map((f) => f.name));
}

/** Download an image (SSRF-guarded) and upload it into the folder. */
export async function uploadImageFromUrl(folderId: string, name: string, url: string): Promise<void> {
  await assertPublicUrl(url);
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 60_000,
    maxRedirects: 5,
    maxContentLength: 30 * 1024 * 1024,
    httpAgent: new http.Agent(ssrfAgentOptions),
    httpsAgent: new https.Agent(ssrfAgentOptions),
  });
  const bytes = Buffer.from(res.data);
  const mime = res.headers["content-type"]?.toString().split(";")[0] || "image/png";

  const boundary = "pipelineBoundary" + Date.now();
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  await driveFetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}
