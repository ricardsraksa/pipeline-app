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
from html import unescape
from pathlib import Path

from scrapling.fetchers import Fetcher, DynamicFetcher

OUT_ROOT = Path.home() / "Desktop" / "scraped"
MIN_BYTES = 15_000          # smaller than this is an icon or swatch, not a photo
WANT_IMAGES = 6
WANT_DESC_IMAGES = 12
BROWSER_ATTEMPTS = 3

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


def is_rate_limited(page) -> bool:
    """AliExpress serves a "punish" interstitial once an IP has fetched too often."""
    h = page.html_content.lower()
    return ("punish" in h or "captcha" in h) and not (page.css("title::text").get() or "").strip()


def fetch(url: str):
    """Text-only first; escalate to a real browser only if the page is empty."""
    page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    if (page.css("title::text").get() or "").strip():
        return page, "text-only"
    print("   page came back empty — starting browser (takes ~10s)...")
    # AliExpress renders inconsistently: sometimes the browser gets the product,
    # sometimes only the shell. Verify the content actually arrived and retry.
    last = None
    for attempt in range(1, BROWSER_ATTEMPTS + 1):
        # capture_xhr grabs the seller's long description, which AliExpress
        # serves from a separate desc.htm module rather than the page itself.
        page = DynamicFetcher.fetch(
            url, headless=True, network_idle=True, timeout=120000,
            wait_selector='[class*="sku-item"], [data-pl="product-title"], h1',
            wait=2000, capture_xhr="desc.htm")
        last = page
        if (page.css("title::text").get() or "").strip():
            return page, "browser"
        if is_rate_limited(page):
            sys.exit(
                "\n   AliExpress is rate-limiting this computer's IP address.\n"
                "   It serves an anti-bot page instead of the product. The IP is what\n"
                "   is throttled, not the browser, so retrying immediately won't help.\n"
                "   Wait an hour or two, or change IP (VPN / proxy / phone hotspot).\n")
        if attempt < BROWSER_ATTEMPTS:
            print(f"   page didn't finish rendering — retry {attempt}/{BROWSER_ATTEMPTS - 1}")
    return last, "browser"


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


def download(urls: list[str], folder: Path, want: int = WANT_IMAGES) -> list[str]:
    """Fetch candidates in order, keeping only files big enough to be real photos."""
    folder.mkdir(parents=True, exist_ok=True)
    kept: list[str] = []
    blobs: set[bytes] = set()
    for u in urls:
        if len(kept) >= want:
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
        m = re.search(r"\.(jpe?g|png|webp)(?:$|[?_])", u, re.I)
        ext = m.group(1).lower() if m else "jpg"
        (folder / f"{len(kept) + 1:02d}.{ext}").write_bytes(blob)
        kept.append(u)
    return kept


# Accessibility labels, nav and checkout chrome — present on every page of a
# storefront and worthless as product copy.
UI_NOISE = re.compile(
    r"open media|abrir elemento|ventana modal|in a modal"
    r"|skip to|ir directamente|saltar al"
    r"|add to cart|a\u00f1adir al carrito|buy it now|comprar ahora|choose options"
    r"|subscribe|newsletter|cookie|privacy policy|terms of service|pol\u00edtica de"
    r"|log in|iniciar sesi\u00f3n|create account|shopping cart|carrito de"
    r"|pickup availability|disponibilidad de retiro|no se pudo cargar"
    r"|view full details|ver detalles|regular price|precio habitual",
    re.I,
)


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


def html_to_text(html: str) -> str:
    txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = unescape(txt).replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", txt)).strip()


def shopify_json(url: str) -> dict | None:
    """Shopify exposes every variant and price at <product-url>.json."""
    if "/products/" not in url:
        return None
    base = url.split("?")[0].rstrip("/")
    try:
        r = Fetcher.get(base + ".json", timeout=20, stealthy_headers=True)
        raw = re.sub(r"^<html><body>|</body></html>$", "", r.html_content.strip())
        return json.loads(raw).get("product")
    except Exception:
        return None


def extract_variants(page, url: str) -> tuple[dict, list]:
    """Every option and value. Shopify via its JSON API, AliExpress from the DOM."""
    prod = shopify_json(url)
    if prod:
        options = {o["name"]: o["values"] for o in prod.get("options", []) if o.get("values")}
        priced = [
            {"title": v.get("title"), "price": v.get("price"), "available": v.get("available")}
            for v in prod.get("variants", [])
        ]
        return options, priced

    # AliExpress: each option group is a "sku-item--property" block. Image
    # swatches carry their name in the img alt, text swatches in a title attr.
    options: dict[str, list[str]] = {}
    for el in page.css('[class*="sku-item"]'):
        if not (el.attrib.get("class") or "").startswith("sku-item--property"):
            continue
        label = " ".join(el.get_all_text().split())
        name = label.split(":")[0].strip() if ":" in label else label[:24]
        vals = [a.strip() for a in el.css("img::attr(alt)").getall() if a and a.strip()]
        vals += [t.strip() for t in el.css("[title]::attr(title)").getall() if t and t.strip()]
        vals = list(dict.fromkeys(vals))
        if name and vals:
            options[name] = vals
    return options, []


def extract_long_description(page, url: str) -> tuple[str, list]:
    """The seller's full description — the real feature claims live here."""
    # AliExpress: served as its own module, captured while the page loaded.
    for r in getattr(page, "captured_xhr", []) or []:
        if "desc.htm" not in str(r.url):
            continue
        body = r.body if isinstance(r.body, str) else (r.body or b"").decode("utf-8", "ignore")
        imgs = [fullsize(u) for u in re.findall(r'src="([^"]+)"', body)
                if u.startswith("http")]
        return html_to_text(body), list(dict.fromkeys(imgs))

    prod = shopify_json(url)
    if prod and (prod.get("body_html") or "").strip():
        html = prod["body_html"]
        imgs = [u for u in re.findall(r'src="([^"]+)"', html) if u.startswith("http")]
        return html_to_text(html), imgs

    # Page-builder storefronts keep the copy in the page itself. Take the visible
    # text, minus the nav/chrome that repeats on every page.
    body = [l for l in visible_lines(page) if len(l) > 40 and not UI_NOISE.search(l)]
    return "\n".join(dict.fromkeys(body))[:6000], []


# --- OCR -------------------------------------------------------------------
# Many AliExpress sellers put their entire pitch inside the description images
# and leave the text nearly empty. macOS ships a text recogniser, so read them.

def ocr_images(paths: list[Path]) -> str:
    try:
        import Vision
        from Foundation import NSURL
    except ImportError:
        return ""
    chunks: list[str] = []
    for path in paths:
        try:
            url = NSURL.fileURLWithPath_(str(path.resolve()))
            handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
            req = Vision.VNRecognizeTextRequest.alloc().init()
            req.setRecognitionLevel_(0)          # accurate
            req.setUsesLanguageCorrection_(True)
            ok, _ = handler.performRequests_error_([req], None)
            if not ok:
                continue
            lines = []
            for obs in (req.results() or []):
                cand = obs.topCandidates_(1)
                if cand:
                    lines.append(cand[0].string())
            if lines:
                chunks.append("\n".join(lines))
        except Exception:
            continue
    # the same slogan often repeats across banners
    seen, out = set(), []
    for line in "\n".join(chunks).split("\n"):
        key = line.strip().lower()
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        out.append(line.strip())
    return "\n".join(out)


# --- competitor positioning -------------------------------------------------

OFFER_RE = re.compile(
    r"free shipping|free delivery|money.?back|satisfaction guarantee|guarantee"
    r"|\d+[- ]day (?:returns?|trial|guarantee)|warranty|risk.?free"
    r"|buy \d+ get \d+|\d+% off|save \d+|bundle|free returns|env[ií]o gratis"
    r"|garant[ií]a|devoluci[oó]n", re.I)
PROOF_RE = re.compile(
    r"\d[\d,.]*\+?\s*(?:happy\s+)?(?:customers|clientes|reviews|rese[nñ]as|sold|families|users)"
    r"|as seen (?:in|on)|featured in|rated \d|trusted by|\b\d\.\d\s*/\s*5", re.I)
CLAIM_HINT_RE = re.compile(
    r"\b(no|without|never|instantly|in \d+ (?:seconds|minutes|nights|days)|clinically"
    r"|designed|engineered|patented|award|#1|only|unlike)\b", re.I)


def extract_positioning(page, prod: dict | None) -> dict:
    """How the competitor sells it: offer, proof, claims, price framing."""
    lines = [l for l in visible_lines(page) if not UI_NOISE.search(l)]
    pos: dict = {}

    if prod:
        if prod.get("vendor"):
            pos["brand"] = prod["vendor"]
        if prod.get("published_at"):
            pos["listed_since"] = prod["published_at"][:10]
        v = (prod.get("variants") or [{}])[0]
        price, was = v.get("price"), v.get("compare_at_price")
        if price and was and str(was) not in ("", "None") and float(was) > float(price):
            pct = round((1 - float(price) / float(was)) * 100)
            pos["discount"] = f"{was} -> {price} ({pct}% off)"

    # skip the title itself — the hero line is the pitch, not the product name
    tname = re.sub(r"[^a-z0-9]", "", (prod or {}).get("title", "").lower())
    for l in lines[:80]:
        if not (25 < len(l) < 160):
            continue
        if tname and re.sub(r"[^a-z0-9]", "", l.lower())[:40] in tname:
            continue
        pos["hero"] = l.strip()
        break

    def gather(rx, limit, lo=12, hi=170):
        out = []
        for l in lines:
            if lo < len(l) < hi and rx.search(l):
                t = l.strip()
                if t not in out:
                    out.append(t)
            if len(out) >= limit:
                break
        return out

    if v := gather(OFFER_RE, 6):
        pos["offers"] = v
    if v := gather(PROOF_RE, 6):
        pos["social_proof"] = v
    if v := gather(CLAIM_HINT_RE, 8, 20, 180):
        pos["claims"] = v
    quotes = [l.strip() for l in lines
              if 40 < len(l) < 300 and re.match(r'^["“”\u201c]', l.strip())]
    if quotes:
        pos["testimonials"] = list(dict.fromkeys(quotes))[:4]
    return pos


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
    options, variant_prices = extract_variants(page, url)
    long_desc, desc_images = extract_long_description(page, url)
    positioning = extract_positioning(page, shopify_json(url))

    folder = OUT_ROOT / slugify(title)
    images = download(candidates(page), folder)
    # The seller's description images are the best ad source material on the page.
    desc_saved = download(desc_images, folder / "description", WANT_DESC_IMAGES) if desc_images else []
    ocr_text = ocr_images(sorted((folder / "description").glob("*"))) if desc_saved else ""
    if not ocr_text:
        ocr_text = ocr_images(sorted(p for p in folder.glob("*") if p.suffix != ".json"))

    facts = [f"{k.capitalize()}: {v}" for k, v in details.items()]
    if price:
        facts.insert(0, f"Price: {price}")
    for name, vals in options.items():
        facts.append(f"{name}: {', '.join(vals)}")
    for v in variant_prices:
        facts.append(f"  - {v['title']}: {v['price']}"
                     + ("" if v.get("available", True) else " (sold out)"))
    pos_block = ""
    if positioning:
        rows = []
        for k, v in positioning.items():
            rows.append(f"{k.replace('_', ' ').title()}:")
            for item in (v if isinstance(v, list) else [v]):
                rows.append(f"  - {item}")
        pos_block = "COMPETITOR POSITIONING\n" + "\n".join(rows)

    scraped_text = "\n\n".join(x for x in [
        title, desc, "\n".join(facts),
        ("FULL DESCRIPTION\n" + long_desc[:3000]) if long_desc else "",
        ("COPY FROM IMAGES\n" + ocr_text[:3000]) if ocr_text else "",
        pos_block,
    ] if x)
    clipboard_set(scraped_text)
    (folder / "data.json").write_text(json.dumps(
        {"url": url, "mode": mode, "title": title, "description": desc,
         "price": price, **details, "options": options,
         "variants": variant_prices, "long_description": long_desc,
         "image_text": ocr_text, "positioning": positioning,
         "images": images, "description_images": desc_images},
        indent=2, ensure_ascii=False))

    print(f"   mode:   {mode}")
    print(f"   title:  {title[:70]}")
    print(f"   price:  {price}")
    for k, v in details.items():
        print(f"   {k + ':':8}{v}")
    for name, vals in options.items():
        print(f"   {name + ':':8}{', '.join(vals)}")
    if variant_prices:
        for v in variant_prices:
            print(f"     - {v['title']}: {v['price']}")
    print(f"   long description: {len(long_desc):,} chars")
    if ocr_text:
        print(f"   copy read from images: {len(ocr_text):,} chars")
    for k, v in positioning.items():
        if isinstance(v, list):
            print(f"   {k}: {len(v)} found")
            for item in v[:3]:
                print(f"       {item[:76]}")
        else:
            print(f"   {k}: {v}")
    print(f"   images: {len(images)} product"
          + (f" + {len(desc_saved)} description" if desc_images else "") + " saved")
    print(f"\n   Folder:    {folder}")
    print("   Clipboard: product text copied — paste it into the pipeline app.\n")


if __name__ == "__main__":
    main()
