import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
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
app.get(
  '/docs',
  Scalar({
    customCss: SCALAR_CUSTOM_CSS,
    favicon: '/favicon.ico',
    pageTitle: 'LobeHub API',
    // 'none' keeps the runtime bundle from injecting its own theme stylesheet
    // after our customCss, which would override every variable we set.
    theme: 'none',
    url: '/api/v1/openapi.json',
  }),
);

// Register routes
Object.entries(routes).forEach(([key, value]) => app.route(`/${key}`, value));

export { app as honoApp };
