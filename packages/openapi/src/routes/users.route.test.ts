import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// the route module pulls in the db graph (via `requirePermission`) and the
// better-auth graph (via `requireAuth`) at import time; this test is only
// about which gates the route itself declares
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers', () => ({
  UserController: class {
    getCurrentUser(c: any) {
      return c.json({ data: { id: 'user-1' }, success: true });
    }
  },
}));

const { default: UserRoutes } = await import('./users.route');

/**
 * A key minted with narrow scopes still has to be able to identify itself, or
 * `lh login` cannot resolve a userId from it. Guarding this route on
 * `user:read` stranded such keys outside the product — see LOBE-12934.
 */
describe('GET /users/me', () => {
  const requestAs = (apiKeyScopes: string[]) => {
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, apiKeyScopes as never);
      await next();
    });
    app.route('/', UserRoutes);

    return app.request('/me');
  };

  it('is reachable by a restricted API key that holds no user scope', async () => {
    const res = await requestAs(['agent:read']);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { id: 'user-1' } });
  });

  it('is reachable by a key holding unrelated scopes only', async () => {
    const res = await requestAs(['model:invoke']);

    expect(res.status).toBe(200);
  });
});
