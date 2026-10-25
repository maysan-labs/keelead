// Next.js calls register() once per runtime at server start. This is the ONLY hook
// @sentry/nextjs can initialise the server SDK from — nothing auto-loads
// sentry.server.config.ts, so removing these imports silently disables error reporting.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
