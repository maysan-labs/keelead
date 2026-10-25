/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

const nextConfig = {
  // Maysan Labs: the production image ships the standalone server (`server.js` plus a
  // pruned node_modules). Without this, `next build` produces no `.next/standalone`
  // and the Dockerfile's runtime stage fails at COPY.
  output: 'standalone',
  experimental: {
    // Next 14 only loads src/instrumentation.ts with this flag on, and that hook is the
    // only place @sentry/nextjs can initialise the server SDK from.
    instrumentationHook: true,
  },
}

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  // GlitchTip's free tier issues no auth token, so source-map upload stays off.
  sourcemaps: { disable: true },
})
