"""
Product scraper for AliExpress and Alibaba with Cloudflare R2 upload.

Workflow:
  1. Scrape product page (title, description, specs, raw image URLs)
  2. Download all images
  3. Upload all images to Cloudflare R2
  4. Return JSON with R2 image URLs for manual review in the app

Data sources (verified for AliExpress as of May 2026):
  - Images:      window._d_c_.DCData.imagePathList
  - Title:       document.title (strip " - AliExpress" suffix)
  - Specs:       .specification--prop--* elements (.specification--title + .specification--desc)
  - Description: meta[name="description"] (full description requires login/click)

Dependencies:
    pip install playwright beautifulsoup4 boto3 python-dotenv
    playwright install chromium

Environment variables required (.env file):
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_ACCOUNT_ID=...
    R2_BUCKET_NAME=...
    R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page

load_dotenv()


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OUTPUT_DIR = Path("scraped_output")
IMAGE_DIR = OUTPUT_DIR / "images"

BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

MAX_IMAGES = 50
HEADLESS = os.environ.get("SCRAPER_HEADLESS", "true").lower() == "true"

REQUIRED_R2_ENV = [
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
]

EXT_TO_CONTENT_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def validate_env() -> None:
    missing = [k for k in REQUIRED_R2_ENV if not os.environ.get(k)]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}. "
            "Set them in .env or your environment before running."
        )


def detect_platform(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "aliexpress" in host:
        return "aliexpress"
    if "alibaba" in host:
        return "alibaba"
    raise ValueError(f"Unsupported URL: {url}")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "product"


def normalize_url(url: str) -> str:
    """Ensure URL has https scheme."""
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http://"):
        return "https://" + url[7:]
    return url


def clean_image_urls(urls: list[str]) -> list[str]:
    """Deduplicate and clean image URLs, preserving original size suffixes."""
    seen = set()
    clean = []
    for u in urls:
        if not u or len(u) < 20:
            continue
        # Strip query strings (analytics params), keep the path intact
        base = re.sub(r"\?.*$", "", u)
        # Strip trailing size suffix added by AliExpress (e.g. _350x350.jpg_480x480.jpg)
        # Only strip the LAST suffix to get original-size image
        base = re.sub(r"_\d+x\d+\.(jpg|jpeg|png|webp)$", r".\1", base, flags=re.IGNORECASE)
        if base not in seen:
            seen.add(base)
            clean.append(base)
    return clean


async def download_image_bytes(page: Page, url: str) -> tuple[bytes | None, str | None]:
    """Returns (bytes, error_message). On success: (bytes, None). On failure: (None, reason)."""
    try:
        response = await page.request.get(url, timeout=15000)
        if not response.ok:
            return None, f"HTTP {response.status}"
        body = await response.body()
        if len(body) < 5000:
            return None, f"too small ({len(body)} bytes)"
        return body, None
    except Exception as e:
        return None, str(e)


async def detect_and_wait_for_captcha(page: Page, max_wait_seconds: int = 300) -> bool:
    """
    Detect if a captcha/verification challenge is on the page and pause for manual solving.

    Returns True if the page is clear (no captcha, or captcha was solved), False if timed out.
    Common AliExpress/Alibaba captcha indicators:
      - "nc_iframe" slider captcha
      - "punish" or "verification" in URL
      - Specific text on the page
    """
    captcha_selectors = [
        "iframe[id*='nc_iframe']",
        "iframe[id*='captcha']",
        "iframe[src*='captcha']",
        "iframe[src*='punish']",
        "[class*='nc-container']",
        "[class*='captcha']",
        "[id*='baxia']",
    ]

    captcha_text_phrases = [
        "verify", "verification", "slide to verify", "drag the slider",
        "are you human", "security check", "please verify",
    ]

    # Check URL for verification redirects
    current_url = page.url.lower()
    url_blocked = any(kw in current_url for kw in ["punish", "verification", "_____tmd_____"])

    # Check for captcha elements
    has_captcha_element = False
    for selector in captcha_selectors:
        try:
            count = await page.locator(selector).count()
            if count > 0:
                has_captcha_element = True
                break
        except Exception:
            continue

    # Check page text content
    has_captcha_text = False
    try:
        body_text = await page.evaluate("() => document.body ? document.body.innerText.toLowerCase().substring(0, 2000) : ''")
        has_captcha_text = any(phrase in body_text for phrase in captcha_text_phrases)
    except Exception:
        pass

    if not (url_blocked or has_captcha_element or has_captcha_text):
        return True  # No captcha detected, page is clear

    # Captcha detected
    print("\n" + "=" * 70)
    print("  CAPTCHA / VERIFICATION DETECTED")
    print("=" * 70)
    print("  AliExpress is asking for human verification.")
    print("  → Switch to the browser window and solve the captcha manually.")
    print(f"  → The scraper will resume automatically once the page loads correctly.")
    print(f"  → Timeout: {max_wait_seconds} seconds")
    print("=" * 70 + "\n")

    if HEADLESS:
        print("  [error] Cannot solve captcha in headless mode.")
        print("  [error] Re-run with SCRAPER_HEADLESS=false to solve manually.")
        return False

    # Poll every 2 seconds to see if the user solved the captcha
    elapsed = 0
    poll_interval = 2
    while elapsed < max_wait_seconds:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        # Re-check: is the captcha gone?
        try:
            current_url = page.url.lower()
            url_still_blocked = any(kw in current_url for kw in ["punish", "verification", "_____tmd_____"])

            still_has_element = False
            for selector in captcha_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        still_has_element = True
                        break
                except Exception:
                    continue

            if not url_still_blocked and not still_has_element:
                print(f"  [ok] Captcha cleared after {elapsed}s. Continuing...")
                await page.wait_for_timeout(2000)  # Let page settle
                return True
        except Exception:
            continue

        if elapsed % 30 == 0:
            print(f"  [waiting] Still waiting for captcha ({elapsed}s / {max_wait_seconds}s)...")

    print(f"  [timeout] Captcha not solved after {max_wait_seconds}s. Aborting.")
    return False


# ---------------------------------------------------------------------------
# AliExpress scraper
# ---------------------------------------------------------------------------

async def scrape_aliexpress(page: Page, url: str) -> dict:
    """
    Verified data sources:
      - Images: window._d_c_.DCData.imagePathList (set on page load)
      - Title: document.title -- strip " - AliExpress" suffix
      - Specs: .specification--prop--* (each with --title and --desc children)
      - Description: meta[name="description"]
    """
    print(f"  [aliexpress] Loading page...")
    await page.goto(url, wait_until="domcontentloaded", timeout=60000)

    # Check for captcha and wait for manual solve if needed
    captcha_ok = await detect_and_wait_for_captcha(page)
    if not captcha_ok:
        raise RuntimeError("AliExpress captcha could not be solved -- aborting scrape")

    # Wait for the spec section to render (signals page is fully loaded)
    try:
        await page.wait_for_selector("[class*='specification--prop'], [class*='product-price']", timeout=15000)
    except Exception:
        print("  [warn] Page did not render expected elements -- continuing anyway")

    # Allow late JS to run
    await page.wait_for_timeout(2000)

    result = {
        "platform": "aliexpress",
        "url": url,
        "title": "",
        "description": "",
        "specs": {},
        "image_urls": [],
    }

    # 1. Extract images from window._d_c_.DCData.imagePathList
    try:
        image_list = await page.evaluate(
            "() => (window._d_c_ && window._d_c_.DCData && window._d_c_.DCData.imagePathList) || []"
        )
        if image_list and isinstance(image_list, list):
            result["image_urls"] = [normalize_url(u) for u in image_list if isinstance(u, str)]
            print(f"  [aliexpress] Found {len(result['image_urls'])} images in DCData")
    except Exception as e:
        print(f"  [warn] Image extraction from DCData failed: {e}")

    # 2. Extract title from document.title
    try:
        page_title = await page.evaluate("() => document.title || ''")
        # AliExpress format: "Product Name - AliExpress NNN"
        title = re.split(r"\s*-\s*AliExpress", page_title, maxsplit=1)[0].strip()
        result["title"] = title
    except Exception as e:
        print(f"  [warn] Title extraction failed: {e}")

    # 3. Extract specs from DOM
    try:
        specs = await page.evaluate("""
            () => {
                const props = document.querySelectorAll('[class*="specification--prop--"]');
                const result = {};
                props.forEach(prop => {
                    const titleEl = prop.querySelector('[class*="specification--title--"]');
                    const descEl = prop.querySelector('[class*="specification--desc--"]');
                    if (titleEl && descEl) {
                        const key = titleEl.textContent.trim();
                        // Prefer title attribute (clean), fall back to textContent
                        const val = descEl.getAttribute('title') || descEl.textContent.trim();
                        if (key && val) result[key] = val;
                    }
                });
                return result;
            }
        """)
        if specs:
            result["specs"] = specs
            print(f"  [aliexpress] Found {len(specs)} specs")
    except Exception as e:
        print(f"  [warn] Specs extraction failed: {e}")

    # 4. Extract description from meta tag (most reliable)
    try:
        meta_desc = await page.evaluate(
            "() => { const m = document.querySelector('meta[name=\"description\"]'); return m ? m.content : ''; }"
        )
        if meta_desc:
            result["description"] = meta_desc.strip()
    except Exception as e:
        print(f"  [warn] Description extraction failed: {e}")

    return result


# ---------------------------------------------------------------------------
# Alibaba scraper
# ---------------------------------------------------------------------------

async def scrape_alibaba(page: Page, url: str) -> dict:
    """
    Alibaba uses different data structures. This is a best-effort scrape using
    multiple fallback strategies. Verify selectors on a real Alibaba product page
    if results are poor.
    """
    print(f"  [alibaba] Loading page...")
    await page.goto(url, wait_until="domcontentloaded", timeout=60000)

    # Check for captcha and wait for manual solve if needed
    captcha_ok = await detect_and_wait_for_captcha(page)
    if not captcha_ok:
        raise RuntimeError("Alibaba captcha could not be solved -- aborting scrape")

    await page.wait_for_timeout(3000)

    # Scroll to trigger lazy-loaded content
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
    await page.wait_for_timeout(2000)
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await page.wait_for_timeout(2000)
    await page.evaluate("window.scrollTo(0, 0)")
    await page.wait_for_timeout(1000)

    result = {
        "platform": "alibaba",
        "url": url,
        "title": "",
        "description": "",
        "specs": {},
        "image_urls": [],
    }

    # 1. Title from page title or h1
    try:
        title_data = await page.evaluate("""
            () => {
                const h1 = document.querySelector('h1');
                const ogTitle = document.querySelector('meta[property="og:title"]');
                return {
                    h1: h1 ? h1.textContent.trim() : '',
                    og: ogTitle ? ogTitle.content : '',
                    title: document.title || ''
                };
            }
        """)
        # Prefer og:title, then h1, then page title with site name stripped
        title = title_data.get("og") or title_data.get("h1") or title_data.get("title", "")
        title = re.split(r"\s*[-|]\s*Alibaba", title, maxsplit=1)[0].strip()
        result["title"] = title
    except Exception as e:
        print(f"  [warn] Title extraction failed: {e}")

    # 2. Images -- try multiple sources
    try:
        image_data = await page.evaluate("""
            () => {
                const urls = new Set();
                // Try og:image
                document.querySelectorAll('meta[property="og:image"]').forEach(m => {
                    if (m.content) urls.add(m.content);
                });
                // Gallery / main product images
                document.querySelectorAll('img').forEach(img => {
                    const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    if (src && (src.includes('alicdn.com') || src.includes('alibaba'))) {
                        urls.add(src);
                    }
                });
                return Array.from(urls);
            }
        """)
        if image_data:
            result["image_urls"] = [normalize_url(u) for u in image_data]
            print(f"  [alibaba] Found {len(result['image_urls'])} images")
    except Exception as e:
        print(f"  [warn] Image extraction failed: {e}")

    # 3. Specs from any tables or attribute lists
    try:
        specs = await page.evaluate("""
            () => {
                const result = {};
                // Try table-based specs
                document.querySelectorAll('table tr').forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        const key = cells[0].textContent.trim();
                        const val = cells[1].textContent.trim();
                        if (key && val && key.length < 100 && val.length < 200) {
                            result[key] = val;
                        }
                    }
                });
                // Try definition lists
                const dts = document.querySelectorAll('dl dt');
                const dds = document.querySelectorAll('dl dd');
                for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
                    const key = dts[i].textContent.trim();
                    const val = dds[i].textContent.trim();
                    if (key && val && !result[key]) result[key] = val;
                }
                return result;
            }
        """)
        if specs:
            result["specs"] = specs
            print(f"  [alibaba] Found {len(specs)} specs")
    except Exception as e:
        print(f"  [warn] Specs extraction failed: {e}")

    # 4. Description from meta tag
    try:
        meta_desc = await page.evaluate(
            "() => { const m = document.querySelector('meta[name=\"description\"]'); return m ? m.content : ''; }"
        )
        if meta_desc:
            result["description"] = meta_desc.strip()
    except Exception as e:
        print(f"  [warn] Description extraction failed: {e}")

    return result


# ---------------------------------------------------------------------------
# Cloudflare R2 upload
# ---------------------------------------------------------------------------

def upload_to_r2(image_paths: list[Path], product_slug: str) -> list[str]:
    account_id = os.environ["R2_ACCOUNT_ID"]
    access_key = os.environ["R2_ACCESS_KEY_ID"]
    secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    bucket = os.environ["R2_BUCKET_NAME"]
    public_url_base = os.environ["R2_PUBLIC_URL"].rstrip("/")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    uploaded_urls = []
    for i, path in enumerate(image_paths):
        suffix = path.suffix.lower()
        key = f"products/{product_slug}/{i + 1:03d}{suffix}"
        content_type = EXT_TO_CONTENT_TYPE.get(suffix, "application/octet-stream")
        try:
            s3.upload_file(
                str(path),
                bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
            uploaded_urls.append(f"{public_url_base}/{key}")
            print(f"  [r2] Uploaded {key}")
        except (BotoCoreError, ClientError) as e:
            print(f"  [warn] R2 upload failed for {path.name}: {e}")

    return uploaded_urls


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def scrape_and_upload(url: str) -> dict:
    validate_env()  # Fail fast if R2 config is missing

    platform = detect_platform(url)
    OUTPUT_DIR.mkdir(exist_ok=True)
    IMAGE_DIR.mkdir(exist_ok=True)

    print(f"[1/3] Scraping {platform} page...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS, args=BROWSER_ARGS)
        context = await browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="Europe/Berlin",
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = await context.new_page()

        try:
            if platform == "aliexpress":
                data = await scrape_aliexpress(page, url)
            else:
                data = await scrape_alibaba(page, url)

            # Clean and deduplicate image URLs
            data["image_urls"] = clean_image_urls(data["image_urls"])[:MAX_IMAGES]
            if len(data["image_urls"]) >= MAX_IMAGES:
                print(f"  [info] Image list capped at MAX_IMAGES ({MAX_IMAGES})")

            slug = slugify(data["title"])
            product_img_dir = IMAGE_DIR / slug
            product_img_dir.mkdir(exist_ok=True)

            print(f"\n[2/3] Downloading {len(data['image_urls'])} images...")
            downloaded_paths = []
            failures = []

            # Reuse the same browser context for downloads (preserves cookies/UA)
            download_page = await context.new_page()
            for i, img_url in enumerate(data["image_urls"]):
                ext = img_url.split(".")[-1].split("?")[0].lower()
                if ext not in ("jpg", "jpeg", "png", "webp"):
                    ext = "jpg"
                dest = product_img_dir / f"{i + 1:03d}.{ext}"
                img_bytes, err = await download_image_bytes(download_page, img_url)
                if img_bytes:
                    dest.write_bytes(img_bytes)
                    downloaded_paths.append(dest)
                else:
                    failures.append((img_url, err))
            await download_page.close()

            print(f"  → Downloaded {len(downloaded_paths)} / {len(data['image_urls'])} images")
            if failures:
                print(f"  [info] {len(failures)} failures (showing first 3):")
                for url, err in failures[:3]:
                    print(f"    - {err}: {url[:80]}")
        finally:
            await browser.close()

    if not downloaded_paths:
        print("[error] No images downloaded")
        data["r2_urls"] = []
        out_file = OUTPUT_DIR / f"{slugify(data['title'])}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return data

    print(f"\n[3/3] Uploading {len(downloaded_paths)} images to R2...")
    r2_urls = upload_to_r2(downloaded_paths, slugify(data["title"]))
    data["r2_urls"] = r2_urls

    out_file = OUTPUT_DIR / f"{slugify(data['title'])}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n[done] {len(r2_urls)} images uploaded to R2")
    print(f"[done] Output saved to {out_file}")
    return data


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scraper_full.py <product_url>")
        sys.exit(1)

    target_url = sys.argv[1]
    try:
        result = asyncio.run(scrape_and_upload(target_url))
    except Exception as e:
        print(f"[fatal] {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)

    print("---OUTPUT_JSON_START---")
    print(json.dumps(result, ensure_ascii=False))
    print("---OUTPUT_JSON_END---")
