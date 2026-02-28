// Auth/Next.js routes that must NOT go to SPA catch-all.
// Shared between middleware (define-config.ts) and the client Link adapter.
export const nextjsOnlyRoutes = [
  '/signin',
  '/signup',
  '/auth-error',
  '/reset-password',
  '/verify-email',
  '/oauth',
  '/market-auth-callback',
  '/discover',
  '/welcome',
];
