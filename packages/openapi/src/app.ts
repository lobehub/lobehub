import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// Import user authentication middleware (supports both OIDC and API Key authentication)
import { userAuthMiddleware } from './middleware/auth';
import { workspaceAuthMiddleware } from './middleware/workspace';
// Import routes
import routes from './routes';

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
app.get('/health', (c) => {
  return c.json({
    service: 'lobe-chat-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Register routes
Object.entries(routes).forEach(([key, value]) => app.route(`/${key}`, value));

export { app as honoApp };
