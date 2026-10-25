// Browser-side Sentry init. On Next 14 the SDK's webpack plugin injects this file into the
// client bundle. NEXT_PUBLIC_SENTRY_DSN is inlined at BUILD time (Dockerfile build arg), so a
// runtime env change alone does not reach the browser.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  // GlitchTip supports neither session replay nor profiling.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
