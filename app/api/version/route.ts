import { NextResponse } from "next/server";
import pkg from "@/package.json";

// Public: which build is live. Lets a deploy be confirmed with curl; the same
// number is shown in the signed-in header. Allow-listed in proxy.ts.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? (pkg as { version: string }).version });
}
