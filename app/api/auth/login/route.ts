import { NextRequest, NextResponse } from "next/server";
import { authConfigured, passwordOk, issueCookieValue, loginAttempt, cookieAttrs, clientIp, COOKIE_NAME } from "@/lib/auth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ success: false, error: "PIPELINE_PASSWORD is not set on the server." }, { status: 503 });
  }

  const ip = clientIp(req.headers);
  const gate = loginAttempt(ip);
  if (!gate.allowed) {
    return NextResponse.json({ success: false, error: "Too many attempts from this address — try again in 15 minutes." }, { status: 429 });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = typeof body.password === "string" ? body.password : "";
  } catch { /* fall through to failure */ }

  // Fixed cost per attempt (success or failure) plus any global escalation.
  await sleep(250 + gate.extraDelayMs);

  if (!passwordOk(password)) {
    return NextResponse.json({ success: false, error: "Wrong password." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, issueCookieValue(), cookieAttrs(req.headers, 30 * 24 * 60 * 60));
  return res;
}
