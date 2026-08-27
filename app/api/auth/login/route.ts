import { NextRequest, NextResponse } from "next/server";
import { authConfigured, passwordOk, issueCookieValue, loginAttemptAllowed, COOKIE_NAME } from "@/lib/auth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ success: false, error: "PIPELINE_PASSWORD is not set on the server." }, { status: 503 });
  }

  // First XFF entry is the client on Render. Spoofable — hence the global
  // backstop inside loginAttemptAllowed and the fixed delay below.
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!loginAttemptAllowed(ip)) {
    return NextResponse.json({ success: false, error: "Too many attempts — try again in 15 minutes." }, { status: 429 });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = typeof body.password === "string" ? body.password : "";
  } catch { /* fall through to failure */ }

  await sleep(250); // fixed cost per attempt, success or failure

  if (!passwordOk(password)) {
    return NextResponse.json({ success: false, error: "Wrong password." }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, issueCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
