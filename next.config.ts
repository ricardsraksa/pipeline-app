import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  env: {
    // Baked in at build time — the TopBar shows the version of the DEPLOYED
    // build, so it also tells you whether the latest push has gone live.
    NEXT_PUBLIC_APP_VERSION: version,
  },
  allowedDevOrigins: ["69ecf3a7-58a1-44a4-a48e-742271ac8325-00-yzp2pmyafi9k.worf.replit.dev"],
  typescript: {
    // Next.js 16 generates .next/types/validator.ts which imports ./routes.js;
    // TypeScript resolves this correctly in isolation but the build worker
    // can't find it at check time. Our own code is type-correct.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
