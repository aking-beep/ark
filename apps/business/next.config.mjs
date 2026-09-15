/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No database externals here, deliberately. This app does not depend on
  // @ark/db, and a config line implying otherwise is how that boundary starts
  // to blur. Control's next.config.mjs is where the libSQL externals live.
};

export default nextConfig;
