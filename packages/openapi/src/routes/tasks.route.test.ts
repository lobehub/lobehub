import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers/task.controller', () => ({
  TaskController: class {
    listRuns(c: any) {
      return c.json({ data: [], success: true });
    }
    runTask(c: any) {
      return c.json({ data: { topicId: 'tpc-1' }, success: true }, 202);
    }
    updateTask(c: any) {
      return c.json({ data: { id: 'task-1' }, success: true });
    }
  },
}));

const { default: TaskRoutes } = await import('./tasks.route');

const requestAs = (scopes: string[], path: string, init?: { body?: unknown; method?: string }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, scopes as never);
    await next();
  });
  app.route('/', TaskRoutes);

  return app.request(path, {
    ...(init?.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init?.method ?? 'GET',
  });
};

describe('POST /tasks/:id/runs', () => {
  it('rejects a read-only key', async () => {
    const res = await requestAs(['agent:read'], '/task-1/runs', { body: {}, method: 'POST' });

    expect(res.status).toBe(403);
  });

  it('starts a run for a key holding agent:write', async () => {
    const res = await requestAs(['agent:write'], '/task-1/runs', {
      body: { prompt: 'focus on Osaka' },
      method: 'POST',
    });

    expect(res.status).toBe(202);
  });

  it('rejects fields the run does not take', async () => {
    const res = await requestAs(['agent:write'], '/task-1/runs', {
      body: { deviceId: 'dev-1' },
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /tasks/:id/runs', () => {
  it('rejects a key that holds no agent scope', async () => {
    const res = await requestAs(['chat:read'], '/task-1/runs');

    expect(res.status).toBe(403);
  });

  it('lists runs for a key holding agent:read', async () => {
    const res = await requestAs(['agent:read'], '/task-1/runs?limit=5');

    expect(res.status).toBe(200);
  });

  it('rejects a page size over 100', async () => {
    const res = await requestAs(['agent:read'], '/task-1/runs?limit=500');

    expect(res.status).toBe(400);
  });
});

describe('PATCH /tasks/:id heartbeatInterval', () => {
  it('accepts an interval of at least ten minutes', async () => {
    const res = await requestAs(['agent:write'], '/task-1', {
      body: { heartbeatInterval: 3600 },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
  });

  it('accepts 0 to turn the heartbeat off', async () => {
    const res = await requestAs(['agent:write'], '/task-1', {
      body: { heartbeatInterval: 0 },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
  });

  it('rejects an interval under ten minutes', async () => {
    const res = await requestAs(['agent:write'], '/task-1', {
      body: { heartbeatInterval: 60 },
      method: 'PATCH',
    });

    expect(res.status).toBe(400);
  });
});
