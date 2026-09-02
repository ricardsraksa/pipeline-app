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

// Expand any textual IPv6 form ("::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1",
// "::ffff:127.0.0.1", zone ids, brackets) into its 8 numeric groups so the
// range checks below are done on VALUES, never on spellings. String matching
// here is what previously let "0::1" or "::ffff:7f00:1" slip past.
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Dotted-quad tail → two hex groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const q = tail.split(".").map(Number);
    if (q.length !== 4 || q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, lastColon + 1) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 0 : fill !== 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(fill).fill("0") : []), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // unparseable → fail closed
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (zeros(7) && (g[7] === 0 || g[7] === 1)) return true;              // :: and ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true;                            // link-local fe80::/10
  if ((g[0] & 0xfe00) === 0xfc00) return true;                            // unique-local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return true;                            // multicast ff00::/8
  if (zeros(5) && g[5] === 0xffff) return isBlockedV4(v4(g[6], g[7]));  // IPv4-mapped ::ffff:0:0/96
  if (zeros(6)) return isBlockedV4(v4(g[6], g[7]));                       // IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedV4(v4(g[6], g[7]));                                    // NAT64 64:ff9b::/96
  }
  if (g[0] === 0x2002) return isBlockedV4(v4(g[1], g[2]));                // 6to4 2002::/16
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

// Agent options that route every socket's DNS lookup through safeLookup —
// attach to http(s).Agent so redirects and DNS rebinding are covered too.
// `lookup` is honoured by the socket layer but not declared on AgentOptions,
// so carry it on an intersection type.
import type http from "node:http";
export const ssrfAgentOptions: http.AgentOptions & { lookup: typeof safeLookup } = {
  lookup: safeLookup,
};

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
