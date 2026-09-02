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

Output:
- product text copied to the clipboard, ready to paste into the app
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
