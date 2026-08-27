// Session auth for the password gate. IMPORTS node:crypto ONLY — never the DB
// or anything that touches env-dependent modules at load time, because this
// runs inside proxy.ts on every request and a module-load throw there locks
// the operator out of the whole app.
//
// Scheme: a stateless HMAC cookie. Value = `v1.<expMs>.<b64url hmac>`, keyed by
// a derivation of PIPELINE_PASSWORD. No second secret: rotating the password in
// Render invalidates every issued cookie, which is the (single-operator) story
// for revocation. Render restarts are a non-event — nothing is stored.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "pipeline_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // sliding renewal inside 7 days
const COOKIE_RE = /^v1\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

export function authConfigured(): boolean {
  return Boolean(process.env.PIPELINE_PASSWORD);
}

function sessionKey(): Buffer {
  // Derivation, not the raw password — the password itself never leaves login.
  return createHmac("sha256", process.env.PIPELINE_PASSWORD ?? "")
    .update("pipeline-session-v1")
    .digest();
}

function mac(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

export function issueCookieValue(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `v1.${exp}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyCookieValue(value: string | undefined | null): { ok: boolean; renew: boolean } {
  if (!value || !authConfigured()) return { ok: false, renew: false };
  const m = COOKIE_RE.exec(value);
  if (!m) return { ok: false, renew: false };
  const exp = Number(m[1]);
  // Compare digests, never raw cookie bytes: recomputing both sides gives two
  // fixed 32-byte buffers, so timingSafeEqual can't throw on length mismatch.
  const expected = createHash("sha256").update(mac(`v1.${exp}`)).digest();
  const presented = createHash("sha256").update(m[2]).digest();
  if (!timingSafeEqual(expected, presented)) return { ok: false, renew: false };
  if (exp <= Date.now()) return { ok: false, renew: false };
  return { ok: true, renew: exp - Date.now() < RENEW_WINDOW_MS };
}

export function passwordOk(submitted: string): boolean {
  if (!authConfigured() || typeof submitted !== "string") return false;
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(process.env.PIPELINE_PASSWORD as string).digest();
  return timingSafeEqual(a, b);
}

// ── Login rate limiting ──────────────────────────────────────────────────────
// In-process on purpose: one operator, one Render instance. Resets on restart;
// the real control is password entropy (generate with `openssl rand -base64 24`).

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 10;
const GLOBAL_LIMIT = 60;

const perIp = new Map<string, { count: number; resetAt: number }>();
let global = { count: 0, resetAt: 0 };

export function loginAttemptAllowed(ip: string): boolean {
  const nowMs = Date.now();
  if (global.resetAt < nowMs) global = { count: 0, resetAt: nowMs + WINDOW_MS };
  if (global.count >= GLOBAL_LIMIT) return false;
  const entry = perIp.get(ip);
  if (!entry || entry.resetAt < nowMs) {
    perIp.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
    global.count++;
    return true;
  }
  if (entry.count >= PER_IP_LIMIT) return false;
  entry.count++;
  global.count++;
  // Bound the map so a spray of spoofed IPs can't grow memory unbounded.
  if (perIp.size > 5000) perIp.clear();
  return true;
}

// ── Route-level guard (defense in depth over the proxy) ─────────────────────
// For the handful of routes that spend money or change global config. Returns
// a 401 Response to send, or null when the session is valid.
export function requireSession(req: Request): Response | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (verifyCookieValue(raw ? decodeURIComponent(raw) : null).ok) return null;
  return new Response(JSON.stringify({ success: false, error: "unauthenticated" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
