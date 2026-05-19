"""
FastAPI HTTP service wrapping scraper_full.py.

Deploy as a separate Render web service. The Next.js app calls POST /scrape
on this service instead of doing its own scraping.

Run locally:
    uvicorn scraper_service:app --reload --port 8000

Run on Render:
    Build:  pip install -r requirements.txt && playwright install chromium && playwright install-deps
    Start:  uvicorn scraper_service:app --host 0.0.0.0 --port $PORT
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from scraper_full import scrape_and_upload

app = FastAPI(title="Pipeline scraper")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScrapeRequest(BaseModel):
    url: str


@app.get("/")
async def root():
    return {"status": "ok", "service": "pipeline-scraper"}


@app.get("/healthz")
async def health():
    return {"status": "ok"}


@app.post("/scrape")
async def scrape(req: ScrapeRequest):
    """
    Scrape a product page and upload its images to R2.

    Returns:
        success=True with scraped_text + images (R2 URLs) + full structured data
        success=False with error message if anything failed
    """
    try:
        data = await scrape_and_upload(req.url)

        # Build scraped_text from all available fields (the more, the better for Stage 1)
        parts = []
        if data.get("title"):
            parts.append(data["title"])
        if data.get("description"):
            parts.append(data["description"])
        specs = data.get("specs") or {}
        if specs:
            spec_lines = "\n".join(f"- {k}: {v}" for k, v in specs.items())
            parts.append(f"Specifications:\n{spec_lines}")
        scraped_text = "\n\n".join(parts)

        # Prefer R2 URLs (persistent, no hotlink protection). Fall back to raw URLs.
        images = data.get("r2_urls") or data.get("image_urls") or []

        return {
            "success": True,
            "scraped_text": scraped_text,
            "images": images,
            "title": data.get("title", ""),
            "description": data.get("description", ""),
            "specs": specs,
            "platform": data.get("platform", ""),
        }
    except Exception as e:
        return {"success": False, "error": f"{type(e).__name__}: {e}"}
