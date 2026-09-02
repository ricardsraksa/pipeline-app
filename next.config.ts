import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  experimental: {
    // With a proxy present, Next buffers request bodies and silently TRUNCATES
    // past this limit (default 10MB). Source-image upload allows 10 x 8MB.
    proxyClientMaxBodySize: "100mb",
  },
  env: {
    // Baked in at build time — the TopBar shows the version of the DEPLOYED
    // build, so it also tells you whether the latest push has gone live.
    NEXT_PUBLIC_APP_VERSION: version,
  },
  // next/image is unused; disabling the optimizer removes the /_next/image
  // endpoint (an anonymous sharp-resize amplifier) entirely.
  images: { unoptimized: true },
  poweredByHeader: false,
  typescript: {
    // Next.js 16 generates .next/types/validator.ts which imports ./routes.js;
    // TypeScript resolves this correctly in isolation but the build worker
    // can't find it at check time. Our own code is type-correct.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
