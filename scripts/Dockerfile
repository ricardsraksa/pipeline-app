# Playwright Python image with all browsers + system deps pre-installed.
# Using v1.49.0 to match playwright==1.49.0 in requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

# Install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY scraper_full.py scraper_service.py ./

# Render injects PORT; default to 10000 for local runs
ENV PORT=10000
EXPOSE 10000

# Use sh -c so $PORT expands at runtime
CMD ["sh", "-c", "uvicorn scraper_service:app --host 0.0.0.0 --port ${PORT}"]
