import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type * as PermissionCheck from '../middleware/permission-check';

// The route module pulls in the db graph (via the permission middleware) and the
// better-auth graph (via `requireAuth`) at import time; this test is only about
// which gates the route itself declares.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/permission-check', async (importOriginal) => {
  const actual = await importOriginal<typeof PermissionCheck>();
  return { ...actual, requireAnyPermission: () => async (_c: any, next: any) => next() };
});
vi.mock('../controllers/eval.controller', () => ({
  EvalController: class {
    createRun(c: any) {
      return c.json({ data: { id: 'run-1' }, success: true });
    }
  },
}));

const { default: EvalRoutes } = await import('./eval.route');

/**
 * `/eval/runs` queues an internal run, which pre-creates real chat topics via
 * `TopicModel` and keeps writing topic/message state from the QStash workflow.
 * A key deliberately denied `chat:write` must not be able to persist chat
 * artifacts through this entry point — same boundary `/responses` enforces.
 */
describe('POST /eval/runs API-key scopes', () => {
  const requestAs = (apiKeyScopes: string[]) => {
    const app = new Hono();

    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, apiKeyScopes as never);
      await next();
    });
    app.route('/', EvalRoutes);

    return app.request('/runs', {
      body: JSON.stringify({ datasetId: 'dataset-1', targetAgentId: 'agent-1' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  };

  it('rejects a key holding agent:write and model:invoke but not chat:write', async () => {
    const res = await requestAs(['agent:write', 'model:invoke']);

    expect(res.status).toBe(403);
  });

  it('accepts a key holding the full agent-run trio', async () => {
    const res = await requestAs(['agent:write', 'chat:write', 'model:invoke']);

    expect(res.status).toBe(200);
  });
});
