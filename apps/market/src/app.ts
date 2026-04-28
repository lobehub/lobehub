import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { jsonError, MarketHttpError, notImplemented } from './http/errors';
import { createHealthRoutes } from './http/routes/health';

export const createMarketApp = () => {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', logger());

  app.route('/', createHealthRoutes());

  app.all('/lobehub-oidc/auth', (c) => notImplemented(c, '/lobehub-oidc/auth'));
  app.all('/lobehub-oidc/token', (c) => notImplemented(c, '/lobehub-oidc/token'));
  app.all('/lobehub-oidc/handoff', (c) => notImplemented(c, '/lobehub-oidc/handoff'));
  app.all('/oauth/token', (c) => notImplemented(c, '/oauth/token'));
  app.all('/api/v1/clients/register', (c) => notImplemented(c, '/api/v1/clients/register'));

  app.notFound((c) => jsonError(c, 404, 'not_found', 'Requested Market endpoint was not found.'));

  app.onError((error, c) => {
    if (error instanceof MarketHttpError) {
      return jsonError(c, error.status, error.code, error.message);
    }

    console.error('[market] unhandled error:', error);
    return jsonError(c, 500, 'internal_error', 'Internal Market service error.');
  });

  return app;
};
