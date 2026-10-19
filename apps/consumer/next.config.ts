import type { NextConfig } from "next";

// No rewrites: they run before route handlers, so a /v1 rewrite would send
// traffic straight upstream and skip app/v1/[...path] (path re-encoding, header
// allow-list, body cap, timeout). The handlers read API_ORIGIN at request time.
// On Vercel, vercel.json routes /v1 and /health to the API service.
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
