/** @type {import('next').NextConfig} */
const nextConfig = {
  // Maysan Labs: the production image ships the standalone server (`server.js` plus a
  // pruned node_modules). Without this, `next build` produces no `.next/standalone`
  // and the Dockerfile's runtime stage fails at COPY.
  output: 'standalone',
  experimental: {},
}

module.exports = nextConfig
