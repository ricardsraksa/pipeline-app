# pipeline-app on Render (Docker runtime).
#
# Why Docker: Stage 1 runs scrapling (Python + a real Chromium) for supplier
# pages that only render client-side. The Playwright base image ships Python
# 3.12, Chromium and every system library it needs; we add Node for Next.js.
# The playwright tag MUST match the playwright pin in scripts/requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SCRAPLING_PYTHON=python3 \
    PIP_BREAK_SYSTEM_PACKAGES=1

# Node 22 (Next 16 needs >= 20).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first (rarely change → cached layer).
COPY scripts/requirements.txt scripts/requirements.txt
RUN pip install --no-cache-dir -r scripts/requirements.txt

# Node deps — dev deps included: the build script typechecks (tsc) before
# `next build`, and NODE_ENV=production would otherwise make npm skip them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# App.
COPY . .
RUN npm run build

EXPOSE 10000
CMD ["node", "server.mjs"]
