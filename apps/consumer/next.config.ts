import type { NextConfig } from "next";

const api =
  process.env.API_ORIGIN ?? (process.env.VERCEL ? "" : "http://127.0.0.1:8472");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    if (!api) return [];
    return [
      { source: "/health", destination: `${api}/health` },
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
    ];
  },
};

export default nextConfig;
