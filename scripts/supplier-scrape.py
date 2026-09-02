#!/usr/bin/env python3
"""
Supplier / competitor page scraper for the pipeline app.

Usage:
    scrapling-py ~/Desktop/supplier-scrape.py <url>
    scrapling-py ~/Desktop/supplier-scrape.py          (uses the URL on your clipboard)

Tries a fast text-only fetch first and only starts a browser if the page comes
back empty (AliExpress needs the browser; Shopify stores don't).

Puts the product text on your clipboard ready to paste into the pipeline app,
and saves the product images to ~/Desktop/scraped/<product>/
"""
import re
import sys
import json
import subprocess
import urllib.request
from pathlib import Path

from scrapling.fetchers import Fetcher, DynamicFetcher

OUT_ROOT = Path.home() / "Desktop" / "scraped"
MIN_BYTES = 15_000          # smaller than this is an icon or swatch, not a photo
WANT_IMAGES = 6

# Gallery images often sit in a JSON blob rather than an <img> tag. They're
# recognisable by a descriptive, hyphenated filename (Wall-Lights-With-Remote.jpg)
# rather than a bare hash or a "27x27" dimension segment.
GALLERY_RE = re.compile(
    r'https?://[^\s"\'\\<>]+?/[A-Za-z0-9]{6,}/'
    r'(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}'
    r'\.(?:jpe?g|png|webp)(?:_[^\s"\'\\<>]*?)?(?=["\'\\\s<>])',
    re.I,
)
PRICE_RE = re.compile(
    r"[€$£]\s?\d{1,4}(?:[.,]\d{3})*[.,]\d{2}"       # €14.49  $49.00
    r"|\d{1,4}(?:[.,]\d{3})*[.,]\d{2}\s?[€$£]"      # 14,49 €
)


def clipboard_get() -> str:
    return subprocess.run(["pbpaste"], capture_output=True, text=True).stdout.strip()


def clipboard_set(text: str) -> None:
    subprocess.run(["pbcopy"], input=text, text=True)


def slugify(s: str, fallback: str = "product") -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower()).strip()
    return (re.sub(r"[\s_-]+", "-", s)[:50].strip("-") or fallback)


def fetch(url: str):
    """Text-only first; escalate to a real browser only if the page is empty."""
    page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    if (page.css("title::text").get() or "").strip():
        return page, "text-only"
    print("   page came back empty — starting browser (takes ~10s)...")
    return DynamicFetcher.fetch(url, headless=True, network_idle=True, timeout=90000), "browser"


def fullsize(u: str) -> str:
    """Strip CDN resize suffixes so we fetch the original, not a thumbnail."""
    u = u.split("?")[0]
    u = re.sub(r"\.(jpe?g|png|webp)_.*$", r".\1", u, flags=re.I)        # AliExpress
    u = re.sub(r"_\d+x\d*(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)  # Shopify
    return u


def candidates(page) -> list[str]:
    """Product images, best first: og:image, then gallery blob, then <img> tags."""
    found: list[str] = []

    og = page.css("meta[property='og:image']::attr(content)").get()
    if og:
        found.append(og)

    found += GALLERY_RE.findall(page.html_content)

    for src in page.css("img::attr(src)").getall() + page.css("img::attr(data-src)").getall():
        if src and not src.startswith("data:"):
            found.append("https:" + src if src.startswith("//") else src)

    out, seen = [], set()
    for u in found:
        if not u.startswith("http"):
            continue
        u = fullsize(u)
        if not re.search(r"\.(jpe?g|png|webp)$", u, re.I):
            continue
        if re.search(r"(sprite|icon|logo|avatar|placeholder|loading|payment|flag|banner)", u, re.I):
            continue
        # icons live under a dimension-named segment: /kf/<id>/27x27.png
        if re.search(r"/\d{1,3}x\d{1,4}\.(?:jpe?g|png|webp)$", u, re.I):
            continue
        # key on the last two segments: gallery images share a filename but differ by id
        key = "/".join(u.split("/")[-2:])
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def download(urls: list[str], folder: Path) -> list[str]:
    """Fetch candidates in order, keeping only files big enough to be real photos."""
    folder.mkdir(parents=True, exist_ok=True)
    kept: list[str] = []
    blobs: set[bytes] = set()
    for u in urls:
        if len(kept) >= WANT_IMAGES:
            break
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                blob = r.read()
        except Exception:
            continue
        if len(blob) < MIN_BYTES or blob in blobs:
            continue
        blobs.add(blob)
        ext = re.search(r"\.(jpe?g|png|webp)$", u, re.I).group(1).lower()
        (folder / f"{len(kept) + 1:02d}.{ext}").write_bytes(blob)
        kept.append(u)
    return kept


def visible_lines(page) -> list[str]:
    txt = re.sub(r"[ \t]+", " ", page.get_all_text(ignore_tags=("script", "style")))
    return [l.strip() for l in txt.split("\n") if l.strip()]


def extract_details(page) -> dict:
    """Sales signals worth having for product research: demand, proof, options."""
    lines = visible_lines(page)
    if not lines:
        return {}

    # The listing's OWN numbers sit above the recommendation carousels; anything
    # below them ("4,000+ sold") belongs to a different product entirely.
    cut = len(lines)
    for marker in ("More to love", "Related items", "You May Also Like"):
        for i, l in enumerate(lines):
            if l.strip().lower() == marker.lower():
                cut = min(cut, i)
                break
    head = lines[:cut]

    d: dict[str, str] = {}
    for l in head:
        if "sold" not in d:
            # two AliExpress formats: "50 sold" and
            # "This seller: 317 sales | Total sales: 342"
            if m := re.fullmatch(r"([\d,.]+\+?)\s*sold", l, re.I):
                d["sold"] = m.group(1)
            elif m := re.search(r"Total sales:\s*([\d,]+)", l, re.I):
                d["sold"] = m.group(1)
            elif m := re.search(r"This seller:\s*([\d,]+)\s*sales", l, re.I):
                d["sold"] = m.group(1)
        if "reviews" not in d and (m := re.fullmatch(r"([\d,]+)\s*reviews?", l, re.I)):
            d["reviews"] = m.group(1)
        if "rating" not in d and re.fullmatch(r"[0-5]\.\d", l):
            d["rating"] = l

    whole = "\n".join(lines)
    if m := re.search(r"Sold by (.+?)\.\s*Logistics", whole):
        d["store"] = m.group(1).strip()
    if re.search(r"^Free shipping$", whole, re.M):
        d["shipping"] = "Free shipping"
    if m := re.search(r"^(Delivery:.*)$", whole, re.M):
        d["delivery"] = m.group(1).strip()

    # "Label:" followed by its value — the chosen variant on AliExpress,
    # the spec table on a Shopify storefront. Both are useful copy material.
    specs: dict[str, str] = {}
    for i, l in enumerate(head[:-1]):
        if re.fullmatch(r"[A-Z][A-Za-z ]{2,22}:", l):
            val = head[i + 1].strip()
            if val and len(val) <= 60 and not val.endswith(":"):
                specs.setdefault(l.rstrip(":"), val)
    if specs:
        d["specs"] = "; ".join(f"{k}: {v}" for k, v in list(specs.items())[:12])
    return d


def find_price(page) -> str | None:
    for sel in ("meta[property='og:price:amount']::attr(content)",
                "meta[property='product:price:amount']::attr(content)",
                "meta[itemprop='price']::attr(content)"):
        v = page.css(sel).get()
        if v:
            cur = (page.css("meta[property='og:price:currency']::attr(content)").get()
                   or page.css("meta[property='product:price:currency']::attr(content)").get() or "")
            return f"{v} {cur}".strip()
    m = PRICE_RE.search(page.html_content)
    return m.group(0) if m else None


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else clipboard_get()
    if not url.startswith("http"):
        sys.exit("No URL given. Pass one as an argument, or copy one to your clipboard first.")

    print(f"\nScraping: {url[:90]}\n")
    page, mode = fetch(url)

    title = (page.css("title::text").get() or "").strip()
    desc = (page.css("meta[name='description']::attr(content)").get()
            or page.css("meta[property='og:description']::attr(content)").get() or "").strip()
    price = find_price(page)
    details = extract_details(page)

    folder = OUT_ROOT / slugify(title)
    images = download(candidates(page), folder)

    facts = [f"{k.capitalize()}: {v}" for k, v in details.items()]
    if price:
        facts.insert(0, f"Price: {price}")
    scraped_text = "\n\n".join(
        x for x in [title, desc, "\n".join(facts)] if x)[:4000]
    clipboard_set(scraped_text)
    (folder / "data.json").write_text(json.dumps(
        {"url": url, "mode": mode, "title": title, "description": desc,
         "price": price, **details, "images": images}, indent=2, ensure_ascii=False))

    print(f"   mode:   {mode}")
    print(f"   title:  {title[:70]}")
    print(f"   price:  {price}")
    for k, v in details.items():
        print(f"   {k + ':':8}{v}")
    print(f"   images: {len(images)} saved")
    print(f"\n   Folder:    {folder}")
    print("   Clipboard: product text copied — paste it into the pipeline app.\n")


if __name__ == "__main__":
    main()
