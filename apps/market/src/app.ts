import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { MarketEnv } from './env';
import { jsonError, MarketHttpError, notImplemented } from './http/errors';
import { createAgentRoutes } from './http/routes/agents';
import { createHealthRoutes } from './http/routes/health';
import { createOidcRoutes } from './http/routes/oidc';
import { createUpstreamProxyRoutes } from './http/routes/upstream';
import type { MarketDatabase, MarketHonoEnv } from './types';

interface CreateMarketAppOptions {
  db?: MarketDatabase;
  env?: Pick<
    MarketEnv,
    'MARKET_TRUSTED_CLIENT_ID' | 'MARKET_TRUSTED_CLIENT_SECRET' | 'MARKET_UPSTREAM_BASE_URL'
  >;
}

export const createMarketApp = (options: CreateMarketAppOptions = {}) => {
  const app = new Hono<MarketHonoEnv>();

  app.use('*', async (c, next) => {
    if (options.db) c.set('db', options.db);
    if (options.env) c.set('marketEnv', options.env);
    await next();
  });
  app.use('*', cors());
  app.use('*', logger());

  app.route('/', createHealthRoutes());
  app.route('/lobehub-oidc', createOidcRoutes());
  app.route('/api/v1/agents', createAgentRoutes());
  app.route('/api/v1', createUpstreamProxyRoutes());

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
