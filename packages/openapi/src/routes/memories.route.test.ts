import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// The route module pulls in the db graph (via the permission middleware) and the
// better-auth graph (via `requireAuth`) at import time; this test is only about
// the gates the route itself declares, so both are stubbed. The permission
// middleware is deliberately NOT stubbed: the API-key scope narrowing inside it
// is exactly what these cases exercise.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers/memory.controller', () => ({
  MemoryController: class {
    getPersona(c: any) {
      return c.json({ data: {}, success: true });
    }
    listPersonaVersions(c: any) {
      return c.json({ data: [], success: true });
    }
    deleteAll(c: any) {
      return c.json({ data: { success: true }, success: true });
    }
    deleteEntry(c: any) {
      return c.json({ data: { success: true }, success: true });
    }
    listCategory(c: any) {
      return c.json({ data: [], success: true });
    }
  },
}));

const { default: MemoryRoutes } = await import('./memories.route');

/** A request authenticated as an API key holding exactly `scopes`. */
const requestAs = (scopes: string[], path: string, init?: { method?: string }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, scopes as never);
    await next();
  });
  app.route('/', MemoryRoutes);

  return app.request(path, { method: init?.method ?? 'GET' });
};

/**
 * The delegated-key contract for `userMemory` is `user:read` / `user:write`.
 * A restricted key must not reach memory through the `message:create` RBAC
 * permission, which projects to `chat:write`.
 */
describe('GET /memories API-key scopes', () => {
  it('rejects a key holding only an unrelated read scope', async () => {
    const res = await requestAs(['file:read'], '/persona');

    expect(res.status).toBe(403);
  });

  it('accepts a key holding user:read', async () => {
    const res = await requestAs(['user:read'], '/persona');

    expect(res.status).toBe(200);
  });

  it('gates the persona versions and per-category reads the same way', async () => {
    expect((await requestAs(['file:read'], '/persona/versions')).status).toBe(403);
    expect((await requestAs(['user:read'], '/persona/versions')).status).toBe(200);
    expect((await requestAs(['file:read'], '/identities')).status).toBe(403);
    expect((await requestAs(['user:read'], '/identities')).status).toBe(200);
  });
});

describe('destructive memory routes', () => {
  it('refuses a chat-only key on DELETE /memories', async () => {
    const res = await requestAs(['chat:write'], '/', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });

  it('accepts a key holding user:write', async () => {
    const res = await requestAs(['user:write'], '/', { method: 'DELETE' });

    expect(res.status).toBe(200);
  });

  it('refuses a chat-only key on DELETE /memories/:category/:id', async () => {
    const res = await requestAs(['chat:write'], '/identities/mem-1', { method: 'DELETE' });

    expect(res.status).toBe(403);
  });

  it('accepts a key holding user:write on an entry delete', async () => {
    const res = await requestAs(['user:write'], '/identities/mem-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
  });
});
