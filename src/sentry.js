// src/sentry.js
import * as Sentry from '@sentry/node';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0,
  });
}

export { Sentry };
