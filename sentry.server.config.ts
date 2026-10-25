// Server-side Sentry init. Loaded only from instrumentation.ts#register() — @sentry/nextjs
// does NOT auto-load this file, and without that import Sentry.init never runs (which is
// exactly how Mailsender shipped two days of silently dropped errors).
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
});
