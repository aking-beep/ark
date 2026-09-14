/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The libSQL driver is native; it must not be bundled into the server build.
  serverExternalPackages: ['@libsql/client', 'libsql'],
};

export default nextConfig;
