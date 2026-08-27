// App-wide password gate (Next 16: "proxy" is the renamed middleware; it runs
// on the Node.js runtime, so node:crypto in lib/auth.ts is fine).
//
// Every page and API route is blocked without a valid session cookie. Pages
// redirect to /login; /api/* gets a JSON 401 so client fetch() calls fail
// legibly instead of choking on an HTML login page.

import { NextRequest, NextResponse } from "next/server";
import { authConfigured, verifyCookieValue, issueCookieValue, COOKIE_NAME } from "@/lib/auth";

function withCommonHeaders(res: NextResponse): NextResponse {
  // The app lives on a guessable public hostname — keep it out of indexes.
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

function json401(error: string): NextResponse {
  return withCommonHeaders(
    new NextResponse(JSON.stringify({ success: false, error }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
}

export function proxy(req: NextRequest) {
  const p = req.nextUrl.pathname;

  // Belt-and-braces allowlist (the matcher below should exclude assets, but a
  // matcher typo alone must never be able to produce a redirect loop).
  if (p === "/login" || p.startsWith("/api/auth/") || p === "/favicon.ico" || p.startsWith("/_next/")) {
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
    if (p.startsWith("/api/")) return json401("unauthenticated");
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", p + (req.nextUrl.search || ""));
    return withCommonHeaders(NextResponse.redirect(login));
  }

  // Cross-site mutation check (CSRF): SameSite=Lax already keeps the cookie
  // off cross-site POSTs; this rejects anything a browser labels cross-origin.
  // 'none' (address bar) and a missing header (curl, same-origin fetch in some
  // agents) are allowed.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const sfs = req.headers.get("sec-fetch-site");
    if (sfs && sfs !== "same-origin" && sfs !== "none") {
      return json401("cross-site request rejected");
    }
  }

  const res = withCommonHeaders(NextResponse.next());
  if (session.renew) {
    res.cookies.set(COOKIE_NAME, issueCookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
