// Session auth for the password gate. IMPORTS node:crypto ONLY — never the DB
// or anything that touches env-dependent modules at load time, because this
// runs inside proxy.ts on every request and a module-load throw there locks
// the operator out of the whole app.
//
// Scheme: a stateless HMAC cookie. Value = `v2.<expMs>.<iatMs>.<b64url hmac>`,
// keyed by a derivation of PIPELINE_PASSWORD. No second secret: rotating the
// password in Render invalidates every issued cookie, which is the
// (single-operator) story for revocation. Render restarts are a non-event —
// nothing is stored. iat gives an ABSOLUTE lifetime: sliding renewal can
// extend a session, but never past MAX_SESSION_AGE_MS from first login.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "pipeline_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;       // 30 days per issue
const RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;       // sliding renewal inside 7 days
const MAX_SESSION_AGE_MS = 90 * 24 * 60 * 60 * 1000;   // absolute cap from first login
const COOKIE_RE = /^v2\.(\d{1,15})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

export function authConfigured(): boolean {
  return Boolean(process.env.PIPELINE_PASSWORD);
}

function sessionKey(): Buffer {
  // Derivation, not the raw password — the password itself never leaves login.
  return createHmac("sha256", process.env.PIPELINE_PASSWORD ?? "")
    .update("pipeline-session-v2")
    .digest();
}

function mac(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

/** Issue a cookie value. Pass the original iat on renewal to keep the absolute cap. */
export function issueCookieValue(iat = Date.now()): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `v2.${exp}.${iat}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyCookieValue(value: string | undefined | null): { ok: boolean; renew: boolean; iat: number } {
  const no = { ok: false, renew: false, iat: 0 };
  if (!value || !authConfigured()) return no;
  const m = COOKIE_RE.exec(value);
  if (!m) return no;
  const exp = Number(m[1]);
  const iat = Number(m[2]);
  // Compare digests, never raw cookie bytes: recomputing both sides gives two
  // fixed 32-byte buffers, so timingSafeEqual can't throw on length mismatch.
  const expected = createHash("sha256").update(mac(`v2.${exp}.${iat}`)).digest();
  const presented = createHash("sha256").update(m[3]).digest();
  if (!timingSafeEqual(expected, presented)) return no;
  const now = Date.now();
  if (exp <= now) return no;
  if (now - iat > MAX_SESSION_AGE_MS) return no;
  return { ok: true, renew: exp - now < RENEW_WINDOW_MS, iat };
}

export function passwordOk(submitted: string): boolean {
  if (!authConfigured() || typeof submitted !== "string") return false;
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(process.env.PIPELINE_PASSWORD as string).digest();
  return timingSafeEqual(a, b);
}

/** Cookie attributes shared by login, renewal and logout — one definition so
 *  the Secure flag can't drift between them. HTTPS is judged from the proxy
 *  header Render sets, not from the internal (plain-http) socket. */
export function cookieAttrs(headers: Headers, maxAgeSeconds: number) {
  const proto = headers.get("x-forwarded-proto") ?? "";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: proto === "https" || process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}

/** The real client IP behind Render's proxy: the LAST X-Forwarded-For hop
 *  (Render appends the true peer; earlier hops are client-controlled). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return headers.get("x-real-ip") ?? "unknown";
}

// ── Login rate limiting ──────────────────────────────────────────────────────
// In-process on purpose: one operator, one Render instance. Per-IP is the
// brute-force control. The global counter is NOT a lockout (that would let an
// anonymous attacker deny the operator login for 15 minutes at will) — it only
// adds escalating delay, so a spray gets slow rather than shutting the door.

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 10;
const GLOBAL_SOFT_LIMIT = 60;
const MAX_ENTRIES = 5000;

const perIp = new Map<string, { count: number; resetAt: number }>();
let global = { count: 0, resetAt: 0 };

export function loginAttempt(ip: string): { allowed: boolean; extraDelayMs: number } {
  const nowMs = Date.now();
  if (global.resetAt < nowMs) global = { count: 0, resetAt: nowMs + WINDOW_MS };
  global.count++;
  // Escalating delay once the global soft limit is passed: +250ms per step,
  // capped at 10s. Slows a spray; never blocks a legitimate login outright.
  const over = Math.max(0, global.count - GLOBAL_SOFT_LIMIT);
  const extraDelayMs = Math.min(10_000, over * 250);

  const entry = perIp.get(ip);
  if (!entry || entry.resetAt < nowMs) {
    // Evict the OLDEST entries (Map keeps insertion order) rather than
    // clearing everyone — a spoofed-IP spray must not reset its own counters.
    if (perIp.size >= MAX_ENTRIES) {
      let n = 0;
      for (const k of perIp.keys()) { perIp.delete(k); if (++n >= 500) break; }
    }
    perIp.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
    return { allowed: true, extraDelayMs };
  }
  if (entry.count >= PER_IP_LIMIT) return { allowed: false, extraDelayMs };
  entry.count++;
  return { allowed: true, extraDelayMs };
}

// ── Route-level guard (defense in depth over the proxy) ─────────────────────
// Returns a 401 Response to send, or null when the session is valid. Never
// throws: a malformed cookie is simply "no session".
export function requireSession(req: Request): Response | null {
  let raw: string | undefined;
  try {
    const cookieHeader = req.headers.get("cookie") ?? "";
    raw = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
  } catch { raw = undefined; }
  if (raw && verifyCookieValue(raw).ok) return null;
  return new Response(JSON.stringify({ success: false, error: "unauthenticated" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
