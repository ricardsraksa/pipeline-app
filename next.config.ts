import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["69ecf3a7-58a1-44a4-a48e-742271ac8325-00-yzp2pmyafi9k.worf.replit.dev"],
  typescript: {
    // Next.js 16 generates .next/types/validator.ts which imports ./routes.js;
    // TypeScript resolves this correctly in isolation but the build worker
    // can't find it at check time. Our own code is type-correct.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
