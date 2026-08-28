import { Scalar } from '@scalar/hono-api-reference';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { describeRoute } from 'hono-openapi';

import { SCALAR_CUSTOM_CSS } from './docs-theme';
// Import user authentication middleware (supports both OIDC and API Key authentication)
import { userAuthMiddleware } from './middleware/auth';
import { workspaceAuthMiddleware } from './middleware/workspace';
// Import routes
import routes from './routes';
import { buildSpecDocument } from './spec';

// Create Hono app instance
const app = new Hono().basePath('/api/v1');

// Global middleware
app.use('*', cors());
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', userAuthMiddleware); // User authentication middleware
app.use('*', workspaceAuthMiddleware);

// Error handling middleware
app.onError((error: Error, c) => {
  console.error('Hono Error:', error);
  // Middleware-thrown HTTPExceptions (e.g. auth 401) must keep their status
  // instead of being flattened to 500, while staying in the same ApiResponse
  // envelope that BaseController.handleError produces for controller errors.
  const status = error instanceof HTTPException ? error.status : 500;
  return c.json(
    { error: error.message, success: false, timestamp: new Date().toISOString() },
    status,
  );
});

// Health check endpoint
app.get('/health', describeRoute({ summary: 'Health check', tags: ['health'] }), (c) => {
  return c.json({
    service: 'lobe-chat-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// API documentation (public, like the API spec itself).
// The spec is rebuilt from the live routes on first request and cached, so it
// can never lag behind the deployed code; `openapi.yml` at the package root is
// the versioned artifact of the same document for SDK generation and diffing.
let specCache: Awaited<ReturnType<typeof buildSpecDocument>> | null = null;
app.get('/openapi.json', async (c) => {
  specCache ??= await buildSpecDocument(app);
  return c.json(specCache);
});
// Scalar ships built-in UI translations for these locales.
const SCALAR_BUILTIN_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'ru', 'zh-CN'] as const;
type ScalarLocale = (typeof SCALAR_BUILTIN_LOCALES)[number];

/**
 * Resolve the docs UI locale with the same priority the main app uses:
 * `?hl=` query > `LOBE_LOCALE` cookie > `Accept-Language` header.
 * Returns undefined for English (Scalar's default) or unsupported locales.
 */
const resolveDocsLocale = (c: Context): ScalarLocale | undefined => {
  const sources = [
    c.req.query('hl'),
    getCookie(c, 'LOBE_LOCALE'),
    c.req.header('Accept-Language'),
  ].filter(Boolean) as string[];

  for (const source of sources) {
    for (const candidate of source.split(',')) {
      const tag = candidate.split(';')[0].trim();
      if (!tag || tag === 'auto') continue;
      if (tag.toLowerCase().startsWith('zh')) return 'zh-CN';
      const match = SCALAR_BUILTIN_LOCALES.find(
        (locale) => locale === tag || locale === tag.split('-')[0].toLowerCase(),
      );
      if (match) return match === 'en' ? undefined : match;
    }
  }
  return undefined;
};

app.get('/docs', (c, next) => {
  const locale = resolveDocsLocale(c);
  return Scalar({
    customCss: SCALAR_CUSTOM_CSS,
    favicon: '/favicon.ico',
    ...(locale ? { localization: { locale } } : {}),
    pageTitle: 'LobeHub API',
    // 'none' keeps the runtime bundle from injecting its own theme stylesheet
    // after our customCss, which would override every variable we set.
    theme: 'none',
    url: '/api/v1/openapi.json',
  })(c, next);
});

// Register routes
Object.entries(routes).forEach(([key, value]) => app.route(`/${key}`, value));

export { app as honoApp };
