// SSRF guard for the scrape endpoint, which fetches user-supplied URLs from the
// server. Without this, an attacker can point the scraper at internal targets —
// cloud metadata (169.254.169.254), localhost services, RFC-1918 ranges — and
// exfiltrate credentials or reach internal APIs. We block by resolved IP, so a
// hostname that resolves to a private address is rejected too.

import dns from "node:dns";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isBlockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0) return true;                          // 0.0.0.0/8 "this host"
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true;  // 192.0.0.0/24 IETF
  if (a >= 224) return true;                         // multicast + reserved (224–255)
  return false;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;                 // loopback / unspecified
  if (lower.startsWith("fe80")) return true;                          // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;  // unique-local fc00::/7
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);        // IPv4-mapped
  if (mapped) return isBlockedV4(mapped[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) return isBlockedV6(ip);
  return true; // not a parseable IP post-resolution → fail closed
}

// A dns.lookup drop-in for http(s).Agent that rejects private targets at connect
// time. Because the Agent runs this for every socket it opens, it covers the
// initial request, every redirect hop, and DNS rebinding between check and fetch.
export function safeLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  const cb = (typeof options === "function" ? options : callback)!;
  const opts = (typeof options === "function" ? {} : options) as dns.LookupOneOptions;
  dns.lookup(hostname, opts, (err, address, family) => {
    if (err) return cb(err, address as string, family);
    if (typeof address === "string" && isBlockedIp(address)) {
      return cb(new Error(`Blocked SSRF target: ${hostname} → ${address}`), "", 0);
    }
    cb(null, address as string, family);
  });
}

// Pre-flight check: parse, enforce http(s), reject embedded credentials, and
// resolve the host to confirm no address is private/reserved. Throws on any
// violation. Use before handing a URL to any server-side fetcher.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (u.username || u.password) throw new Error("URLs with embedded credentials are not allowed");

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error(`Blocked host: ${host}`);

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Blocked private/reserved IP: ${host}`);
    return u;
  }

  let results: dns.LookupAddress[];
  try { results = await dns.promises.lookup(host, { all: true }); }
  catch { throw new Error(`Could not resolve host: ${host}`); }
  if (!results.length) throw new Error(`Could not resolve host: ${host}`);
  for (const r of results) {
    if (isBlockedIp(r.address)) throw new Error(`Blocked SSRF target: ${host} → ${r.address}`);
  }
  return u;
}
