import { requireSession } from "@/lib/auth";
import { nextProductCode, productCodeDiagnostics } from "@/lib/product-code";

// What the next product code will be, and why. The new-run form shows it, and
// it answers "why did this run get P96?" without guessing at the master doc.
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const [code, diag] = await Promise.all([nextProductCode(), productCodeDiagnostics()]);
  return Response.json({ code, ...diag });
}
