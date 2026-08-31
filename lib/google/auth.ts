// Google service-account auth: signed JWT -> access token, Docs scope ONLY.
// Hand-rolled with node:crypto (~40 lines) — googleapis is a huge dependency
// for one token exchange and one batchUpdate.
//
// Env: GOOGLE_SERVICE_ACCOUNT_JSON — the key file from Google Cloud, pasted
// whole into Render. Parsed LAZILY inside functions, never at module load:
// lib/pipeline-runner.ts imports this chain, and a module-load throw would
// take down every pipeline run, not just the Docs export.

import { createSign } from "node:crypto";

// Docs + Drive. The Drive scope is still sharing-bounded: the service account
// can only see/write inside folders explicitly shared with it (the products
// folder), plus the master doc. drive.file would NOT work here — it hides
// user-created folders from the app, and finding existing product folders is
// the whole point.
const SCOPE = "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function googleDocConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_MASTER_DOC_ID?.trim());
}

export function masterDocId(): string {
  const id = process.env.GOOGLE_MASTER_DOC_ID?.trim();
  if (!id) throw new Error("GOOGLE_MASTER_DOC_ID is not set.");
  return id;
}

export function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the whole key file from Google Cloud.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key.");
  }
  // #1 real-world failure: Render stores the PEM with literal \n sequences.
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}

// Token cache: module memo + single-flight, 60s expiry margin.
let memToken: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;

const b64url = (s: Buffer | string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function fetchToken(): Promise<string> {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 30s in the past guards against clock skew ("invalid_grant" with a
  // useless description when iat lands in Google's future).
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now - 30, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  let signature: string;
  try {
    signature = b64url(signer.sign(sa.private_key));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/DECODER|unsupported/i.test(msg)) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON private_key failed to parse — its newlines are probably escaped. Re-paste the key file unmodified.");
    }
    throw e;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${header}.${claims}.${signature}`,
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google auth failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  memToken = { token: json.access_token, exp: Date.now() + 3600_000 - 60_000 };
  return json.access_token;
}

export async function googleAccessToken(): Promise<string> {
  if (memToken && memToken.exp > Date.now()) return memToken.token;
  if (!inflight) {
    inflight = fetchToken().finally(() => { inflight = null; });
  }
  return inflight;
}
