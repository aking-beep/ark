import type { NextConfig } from "next";

const api =
  process.env.API_ORIGIN ?? (process.env.VERCEL ? "" : "http://127.0.0.1:8472");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Rewrites are a production fallback. Turbopack dev does not always honour them,
  // so app/health and app/v1/[...path] proxy via fit-proxy.ts (timeout + 502/504).
  async rewrites() {
    if (!api) return [];
    return [
      { source: "/health", destination: `${api}/health` },
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
    ];
  },
};

export default nextConfig;
