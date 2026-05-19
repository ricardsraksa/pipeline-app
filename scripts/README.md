# Scraper service

A FastAPI wrapper around `scraper_full.py`. The Next.js app calls this service to scrape product pages (Playwright-based, handles JS-rendered content).

## Files

- `scraper_full.py` — core scraping + R2 upload logic (also runnable as CLI)
- `scraper_service.py` — FastAPI HTTP wrapper exposing `POST /scrape`
- `requirements.txt` — Python dependencies

## Deploy on Render (separate web service)

1. **New → Web Service** in Render dashboard.
2. Connect the same `pipeline-app` repo.
3. Configure:
   - **Name:** `pipeline-scraper`
   - **Root Directory:** `scripts`
   - **Runtime:** `Python 3`
   - **Build Command:**
     ```
     pip install -r requirements.txt && playwright install chromium && playwright install-deps
     ```
   - **Start Command:**
     ```
     uvicorn scraper_service:app --host 0.0.0.0 --port $PORT
     ```
4. **Environment variables** (same R2 creds as the Next.js app):
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_ACCOUNT_ID`
   - `R2_BUCKET_NAME`
   - `R2_PUBLIC_URL`
   - `SCRAPER_HEADLESS=true`
5. Deploy. Copy the public URL (e.g. `https://pipeline-scraper-xxxx.onrender.com`).
6. Back in the Next.js service env vars, add:
   - `SCRAPER_SERVICE_URL=https://pipeline-scraper-xxxx.onrender.com`
7. Redeploy the Next.js service.

## API

### `POST /scrape`

Request:
```json
{ "url": "https://www.aliexpress.com/item/1005008830746035.html" }
```

Response (success):
```json
{
  "success": true,
  "scraped_text": "Product Title\n\nMeta description\n\nSpecifications:\n- Material: Silicone\n- ...",
  "images": ["https://pub-xxxxx.r2.dev/products/slug/001.jpg", "..."],
  "title": "Product Title",
  "description": "Meta description",
  "specs": { "Material": "Silicone", "...": "..." },
  "platform": "aliexpress"
}
```

Response (failure):
```json
{ "success": false, "error": "RuntimeError: ..." }
```

## Run locally

```bash
cd scripts
pip install -r requirements.txt
playwright install chromium
uvicorn scraper_service:app --reload --port 8000
```

Then `curl -X POST http://localhost:8000/scrape -H 'Content-Type: application/json' -d '{"url":"..."}'`.

To handle captchas manually, set `SCRAPER_HEADLESS=false` before starting.
