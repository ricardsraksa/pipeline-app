import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["*.replit.dev", "*.repl.co"],
};

export default nextConfig;
