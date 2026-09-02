# scripts/supplier-scrape.py

Local scraper for product pages the app's own scraper can't read.

## Why this exists

`lib/scrape.ts` fetches a page server-side and reads the HTML. That works for
Shopify storefronts (competitor research) but **not for AliExpress**: those
pages return HTTP 200 with an empty shell and fill themselves in with
JavaScript afterwards, so there is nothing to read server-side. It isn't a
bot-block — better headers or a proxy don't help. Only a real browser gets the
content.

Rather than run a headless browser in production (~1GB of memory, which needs a
larger Render plan than the app's traffic justifies), supplier pages are scraped
on the Mac and pasted in. At ~10 products/week that trade is worth ~$300/year.

The app detects this case and returns a message pointing here instead of
handing the pipeline a blank description.

## Usage

```bash
scrapling-py ~/Desktop/supplier-scrape.py <url>
scrapling-py ~/Desktop/supplier-scrape.py          # uses the URL on the clipboard
```

It tries a fast text-only fetch first and only starts a browser if the page
comes back empty, so Shopify pages stay sub-second and AliExpress escalates
automatically.

## What it captures

| Field | Notes |
|---|---|
| title | |
| description | the listing's meta description (short — 100-300 chars) |
| price | prefers `og:price` meta, falls back to the first currency amount |
| rating | sits directly above the review count on AliExpress |
| reviews | review count |
| sold | units sold — handles both `50 sold` and `Total sales: 342` |
| store | supplier/seller name |
| shipping, delivery | e.g. `Free shipping`, `Delivery: Sep 11 - 18` |
| specs | `Label: value` pairs — the selected variant on AliExpress, the spec table on Shopify |
| options | **every** value of every variant group (all colours, sizes, packs) |
| variants | per-variant price and availability (Shopify only) |
| long_description | the seller's full description |
| images | 6 product photos, full size |
| description_images | up to 12 images from the description block |

### Where each source comes from

| | Variants | Long description |
|---|---|---|
| AliExpress | `sku-item--property` blocks — image swatches carry the value in `img alt`, text swatches in `title` | the `desc.htm` module, captured via `capture_xhr` as the page loads |
| Shopify | `<product-url>.json` — every option, variant, price and stock state | `body_html` if the theme uses it, else the page's visible text minus nav/checkout chrome |

Some AliExpress sellers put all their copy *inside* the description images and
leave the text nearly empty. That is why `description_images` are downloaded —
for those listings they are the description.

### Copy read from images (`image_text`)

Those image-only listings are handled by running OCR over the downloaded
images. It uses the text recogniser built into macOS (`pyobjc-framework-Vision`),
so it is free, local and offline — no API key, no per-image cost. If the
framework isn't installed the field is simply empty and nothing else breaks.

### Competitor positioning (`positioning`)

For a competitor storefront, the interesting part isn't the spec sheet — it's
how they *sell* it:

| Key | What it captures |
|---|---|
| brand | the store's vendor name |
| listed_since | when the product was published — how long they've been running it |
| discount | `compare_at_price -> price` with the percentage |
| hero | the first marketing line that isn't the product name |
| offers | bundles, guarantees, free shipping, returns windows |
| social_proof | customer counts, review counts, "as seen in" |
| claims | benefit and differentiation lines |
| testimonials | quoted customer copy |

Real output from the current competitor set:

```
Glodco      offers   SUMMER SALE: BUY 2 GET 1 FREE + GIFTS
                     30 Day Money Back Guarantee
            claims   "NO MORE BULKY AND UGLY LAMPS"
                     Effortless setup, no tools or wiring needed

Flexoriom   discount 89.99 -> 53.99 (40% off)
            offers   Garantía de devolución de 60 días
            claims   O ves una diferencia real. O no asumes ningún riesgo.
```

## AliExpress rate limiting

AliExpress throttles by IP. After roughly 15-20 browser fetches in an hour it
stops serving product pages and returns an anti-bot interstitial instead. The
script detects this and says so rather than returning an empty result. Stealth
mode and a different browser do not help — only time or a different IP does.
At normal usage (a handful of products a week) you will not hit it.

Sales figures are read only from the section above the recommendation
carousels — the `4,000+ sold` further down the page belongs to other products.

Output:
- title + description + the facts above, copied to the clipboard ready to paste
- images + `data.json` saved to `~/Desktop/scraped/<product>/`

## Requirements

Runs on [Scrapling](https://scrapling.readthedocs.io) in a Python 3.12 venv at
`~/.venvs/scrapling` (the Mac's system Python is 3.9 and can't run it). The
`scrapling-py` wrapper in `~/.local/bin` points at that venv.

Measured on the current supplier/competitor set:

| Site type | Mode | Time |
|---|---|---|
| Shopify storefront | text-only | 0.2–0.6s |
| AliExpress listing | browser | 8–10s |
