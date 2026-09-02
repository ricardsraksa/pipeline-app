import { NextRequest, NextResponse } from "next/server";
import { cookieAttrs, COOKIE_NAME } from "@/lib/auth";

// Cross-site POSTs are rejected upstream in proxy.ts (Sec-Fetch-Site), so a
// third-party page can't force a logout.
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", cookieAttrs(req.headers, 0));
  return res;
}
