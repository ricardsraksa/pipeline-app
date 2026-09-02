// App-wide password gate (Next 16: "proxy" is the renamed middleware; it runs
// on the Node.js runtime, so node:crypto in lib/auth.ts is fine).
//
// Every page and API route is blocked without a valid session cookie. Pages
// redirect to /login; /api/* gets a JSON 401 so client fetch() calls fail
// legibly instead of choking on an HTML login page. Security headers are set
// here so pages AND API responses get them from one place.

import { NextRequest, NextResponse } from "next/server";
import { authConfigured, verifyCookieValue, issueCookieValue, cookieAttrs, COOKIE_NAME } from "@/lib/auth";

// Next's bootstrap scripts and styled components need 'unsafe-inline'; there
// are no third-party scripts, so script-src stays locked to the origin.
// Images come from our R2 bucket and Higgsfield's CDN (https:) plus blob:/data:
// for previews. connect-src is same-origin only — every browser fetch is /api/*.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function withCommonHeaders(res: NextResponse): NextResponse {
  // The app lives on a guessable public hostname — keep it out of indexes.
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  return res;
}

function jsonError(status: number, error: string): NextResponse {
  return withCommonHeaders(
    new NextResponse(JSON.stringify({ success: false, error }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(req: NextRequest) {
  const p = req.nextUrl.pathname;

  // Cross-site mutation check (CSRF) — applied BEFORE the allowlist so logout
  // and login are covered too. SameSite=Lax already keeps the cookie off
  // cross-site POSTs; this rejects anything a browser labels cross-origin.
  // 'none' (address bar) and a missing header (curl) are allowed. 403, not
  // 401: the client's session is fine, the request origin isn't — a 401 would
  // bounce a logged-in operator to the login page.
  if (MUTATING.has(req.method)) {
    const sfs = req.headers.get("sec-fetch-site");
    if (sfs && sfs !== "same-origin" && sfs !== "none") {
      return jsonError(403, "cross-site request rejected");
    }
  }

  // Exact allowlist — nothing under /api/auth/ or /_next/ is public by default;
  // only what's listed here. (The matcher below already skips static assets;
  // this is the second layer so a matcher typo can't become a redirect loop.)
  if (
    p === "/login" ||
    p === "/api/auth/login" ||
    p === "/api/auth/logout" ||
    p === "/favicon.ico" ||
    p.startsWith("/_next/static/")
  ) {
    return withCommonHeaders(NextResponse.next());
  }

  // Fail CLOSED — but with a plain 503 naming the fix, never a redirect (an
  // unset password + redirect would be an unbreakable loop).
  if (!authConfigured()) {
    return withCommonHeaders(
      new NextResponse("PIPELINE_PASSWORD is not set. Add it in the Render environment to enable login.", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );
  }

  const session = verifyCookieValue(req.cookies.get(COOKIE_NAME)?.value);
  if (!session.ok) {
    if (p.startsWith("/api/")) return jsonError(401, "unauthenticated");
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", p + (req.nextUrl.search || ""));
    return withCommonHeaders(NextResponse.redirect(login));
  }

  const res = withCommonHeaders(NextResponse.next());
  if (session.renew) {
    // Sliding renewal keeps the ORIGINAL iat so the absolute cap still applies.
    res.cookies.set(COOKIE_NAME, issueCookieValue(session.iat), cookieAttrs(req.headers, 30 * 24 * 60 * 60));
  }
  return res;
}

export const config = {
  // _next/image is deliberately NOT excluded any more: next/image is unused and
  // images.unoptimized is set, so the optimizer endpoint is gated like any page.
  matcher: ["/((?!_next/static|favicon\\.ico).*)"],
};
