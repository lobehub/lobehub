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
vi.mock('../controllers/goal.controller', () => ({
  GoalController: class {
    listGoals(c: any) {
      return c.json({ data: { goals: [] }, success: true });
    }
    createGoal(c: any) {
      return c.json({ data: { id: 'goal-1' }, success: true }, 201);
    }
  },
}));

const { default: GoalRoutes } = await import('./goals.route');

/** A request authenticated as an API key holding exactly `scopes`. */
const requestAs = (scopes: string[], path: string, init?: { body?: unknown; method?: string }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, scopes as never);
    await next();
  });
  app.route('/', GoalRoutes);

  return app.request(path, {
    ...(init?.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init?.method ?? 'GET',
  });
};

describe('GET /goals API-key scopes', () => {
  it('rejects a key that holds no agent scope', async () => {
    const res = await requestAs(['chat:read'], '/');

    expect(res.status).toBe(403);
  });

  it('accepts a key holding agent:read', async () => {
    const res = await requestAs(['agent:read'], '/');

    expect(res.status).toBe(200);
  });
});

describe('POST /goals API-key scopes and validation', () => {
  it('rejects a read-only key before the body is considered', async () => {
    const res = await requestAs(['agent:read'], '/', {
      body: { title: 'Ship the personal agent' },
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('accepts a key holding agent:write', async () => {
    const res = await requestAs(['agent:write'], '/', {
      body: { title: 'Ship the personal agent' },
      method: 'POST',
    });

    expect(res.status).toBe(201);
  });

  it('rejects a goal without a title', async () => {
    const res = await requestAs(['agent:write'], '/', { body: {}, method: 'POST' });

    expect(res.status).toBe(400);
  });
});
