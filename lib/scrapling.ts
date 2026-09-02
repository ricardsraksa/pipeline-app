// Runs the scrapling scraper (scripts/supplier-scrape.py) as a child process
// and turns its output into something the pipeline can store: text fields
// plus the downloaded photos re-hosted on R2.
//
// The script is the SAME file the operator runs on the Mac — one scraper, two
// entry points. Here it runs with --json (structured stdout, no clipboard) and
// --out (a per-call temp dir instead of ~/Desktop/scraped).
//
// Safety: the URL is checked against the SSRF guard before anything is
// spawned, arguments go as an array (no shell), the process is killed on
// timeout, and only one scrape runs at a time — the browser path costs ~1GB,
// and two of them would OOM the container.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertPublicUrl } from "./ssrf";
import { uploadImageBuffer, r2Configured } from "./r2";

export interface ScraplingVariant { title: string | null; price: string | null; available?: boolean }

export interface ScraplingData {
  url: string;
  /** "text-only" (plain fetch was enough) or "browser" (page needed JS). */
  mode: string;
  title: string;
  description: string;
  price: string | null;
  rating?: string;
  reviews?: string;
  sold?: string;
  store?: string;
  shipping?: string;
  delivery?: string;
  specs?: string;
  options: Record<string, string[]>;
  variants: ScraplingVariant[];
  long_description: string;
  image_text: string;
  positioning: Record<string, string | string[]>;
  scraped_text: string;
  /** Public R2 URLs of the product gallery photos, best first. */
  image_urls: string[];
  /** Public R2 URLs of the seller's description images (copy lives in these). */
  description_image_urls: string[];
}

export type ScraplingOutcome =
  | { ok: true; data: ScraplingData }
  | { ok: false; error: string; rateLimited: boolean; deferred?: boolean };

// Is scrapling importable by the server's python? On the plain Node service it
// isn't (no Docker), so every page is deferred to the Mac worker instead of
// failing. Probed once per process.
let availability: Promise<boolean> | null = null;
export function scraplingAvailable(): Promise<boolean> {
  if (!availability) {
    availability = new Promise((resolve) => {
      try {
        const child = spawn(PYTHON, ["-c", "import scrapling.fetchers"], { stdio: "ignore" });
        const t = setTimeout(() => { child.kill("SIGKILL"); resolve(false); }, 20_000);
        child.on("error", () => { clearTimeout(t); resolve(false); });
        child.on("close", (code) => { clearTimeout(t); resolve(code === 0); });
      } catch { resolve(false); }
    });
  }
  return availability;
}

export const DEFERRED_MESSAGE = "Waiting for your Mac to scrape this page";

const SCRIPT = path.join(process.cwd(), "scripts", "supplier-scrape.py");
const PYTHON = process.env.SCRAPLING_PYTHON?.trim() || "python3";
// Persisted across calls within the container's life so the script's own
// rate-limit spacing (45s between browser fetches) still applies.
const STATE_FILE = path.join(os.tmpdir(), "scrapling-state.json");
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

// One scrape at a time, process-wide.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

interface RawResult {
  url: string;
  mode: string;
  title?: string;
  description?: string;
  price?: string | null;
  options?: Record<string, string[]>;
  variants?: ScraplingVariant[];
  long_description?: string;
  image_text?: string;
  positioning?: Record<string, string | string[]>;
  scraped_text?: string;
  image_files?: string[];
  description_image_files?: string[];
  error?: string;
  rate_limited?: boolean;
  [k: string]: unknown;
}

function runScript(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`scraper timed out after ${Math.round(timeoutMs / 1000)}s`));
      else resolve({ code, stdout, stderr });
    });
  });
}

async function uploadFiles(files: string[], prefix: string): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    try {
      const buf = await readFile(f);
      const { url } = await uploadImageBuffer(buf, { prefix, name: path.basename(f) });
      urls.push(url);
    } catch (err) {
      console.warn(`[scrapling] skipped ${path.basename(f)}:`, err instanceof Error ? err.message : err);
    }
  }
  return urls;
}

/** Scrape one product/competitor page. Never throws — returns an outcome. */
export function scraplingScrape(url: string, opts: { timeoutMs?: number } = {}): Promise<ScraplingOutcome> {
  return serialize(async () => {
    try {
      await assertPublicUrl(url);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Blocked URL", rateLimited: false };
    }
    if (!r2Configured()) {
      return { ok: false, error: "R2 is not configured — scraped photos have nowhere to go.", rateLimited: false };
    }
    if (!(await scraplingAvailable())) {
      return { ok: false, error: DEFERRED_MESSAGE, rateLimited: false, deferred: true };
    }

    const outDir = await mkdtemp(path.join(os.tmpdir(), "scrape-"));
    try {
      const args = ["--json", "--out", outDir, "--state", STATE_FILE, "--refresh", url];
      const { code, stdout, stderr } = await runScript(args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      // The JSON result is the last non-empty stdout line; everything human
      // goes to stderr in --json mode.
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      let raw: RawResult | null = null;
      try { raw = JSON.parse(line) as RawResult; } catch { raw = null; }

      if (!raw) {
        const tail = stderr.trim().split("\n").slice(-4).join(" ").slice(0, 400);
        return { ok: false, error: `scraper exited with code ${code}${tail ? `: ${tail}` : ""}`, rateLimited: /rate-limit/i.test(stderr) };
      }
      if (raw.error) {
        return { ok: false, error: raw.error, rateLimited: Boolean(raw.rate_limited) };
      }

      const prefix = `scrape/${Date.now().toString(36)}`;
      const image_urls = await uploadFiles(raw.image_files ?? [], prefix);
      const description_image_urls = await uploadFiles(raw.description_image_files ?? [], `${prefix}/desc`);

      const data: ScraplingData = {
        url: raw.url,
        mode: raw.mode,
        title: raw.title ?? "",
        description: raw.description ?? "",
        price: raw.price ?? null,
        rating: typeof raw.rating === "string" ? raw.rating : undefined,
        reviews: typeof raw.reviews === "string" ? raw.reviews : undefined,
        sold: typeof raw.sold === "string" ? raw.sold : undefined,
        store: typeof raw.store === "string" ? raw.store : undefined,
        shipping: typeof raw.shipping === "string" ? raw.shipping : undefined,
        delivery: typeof raw.delivery === "string" ? raw.delivery : undefined,
        specs: typeof raw.specs === "string" ? raw.specs : undefined,
        options: raw.options ?? {},
        variants: raw.variants ?? [],
        long_description: raw.long_description ?? "",
        image_text: raw.image_text ?? "",
        positioning: raw.positioning ?? {},
        scraped_text: raw.scraped_text ?? "",
        image_urls,
        description_image_urls,
      };
      if (!data.title && !data.scraped_text) {
        return { ok: false, error: "The page came back empty — nothing to read.", rateLimited: false };
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), rateLimited: false };
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
