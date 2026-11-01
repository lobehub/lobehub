import type { MiddlewareHandler } from 'hono';

/**
 * Hides the route outside local development. Returns 404 rather than 403 so a
 * production deployment looks like it never had the endpoint at all.
 */
export const devOnly = (): MiddlewareHandler => async (c, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return c.json({ error: 'dev only' }, 404);
  }

  await next();
};
