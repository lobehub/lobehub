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
// The type module reads the trigger enum from this service; stubbing it keeps
// the test off the agent-signal service graph.
vi.mock('@/server/services/agentSignal/triggerSourceEvent', () => ({
  AGENT_SIGNAL_TRIGGER_SOURCE_TYPES: ['manual'],
}));
vi.mock('../controllers/agent-signal.controller', () => ({
  AgentSignalController: class {
    emitSourceEvent(c: any) {
      return c.json({ data: {}, success: true }, 202);
    }
    triggerSourceEvent(c: any) {
      return c.json({ data: {}, success: true }, 202);
    }
    listReceipts(c: any) {
      return c.json({ data: [], success: true });
    }
  },
}));

const { default: AgentSignalRoutes } = await import('./signals.route');
const { AgentSignalClientSourceSchema, AgentSignalTriggerSourceSchema } =
  await import('../types/agent-signal.type');

/** A request authenticated as an API key holding exactly `scopes`. */
const requestAs = (scopes: string[], path: string, init?: { body?: unknown; method?: string }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, scopes as never);
    await next();
  });
  app.route('/', AgentSignalRoutes);

  return app.request(path, {
    ...(init?.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init?.method ?? 'GET',
  });
};

const emitBody = () => ({
  payload: {},
  sourceId: 'src-1',
  sourceType: AgentSignalClientSourceSchema.options[0],
});

/**
 * `agentSignal` maps to `agent:write` in the delegated-key catalog, and
 * `emitSourceEvent` / `triggerSourceEvent` additionally require `model:invoke`
 * because the workflows they enqueue call a model. A `chat:write`-only key must
 * not be able to spend model budget.
 */
describe('POST /signals emission API-key scopes', () => {
  it('refuses a chat-only key', async () => {
    const res = await requestAs(['chat:write'], '/source-events', {
      body: emitBody(),
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('refuses a key holding agent:write without model:invoke', async () => {
    const res = await requestAs(['agent:write'], '/source-events', {
      body: emitBody(),
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('accepts a key holding both agent:write and model:invoke', async () => {
    const res = await requestAs(['agent:write', 'model:invoke'], '/source-events', {
      body: emitBody(),
      method: 'POST',
    });

    expect(res.status).toBe(202);
  });

  it('gates the trigger route the same way', async () => {
    const body = { sourceType: AgentSignalTriggerSourceSchema.options[0] };

    expect((await requestAs(['chat:write'], '/trigger', { body, method: 'POST' })).status).toBe(
      403,
    );
    expect((await requestAs(['agent:write'], '/trigger', { body, method: 'POST' })).status).toBe(
      403,
    );
    expect(
      (await requestAs(['agent:write', 'model:invoke'], '/trigger', { body, method: 'POST' }))
        .status,
    ).toBe(202);
  });
});

describe('GET /signals/receipts API-key scopes', () => {
  const path = '/receipts?agentId=agent-1&topicId=topic-1';

  it('refuses a key that holds no agent scope', async () => {
    const res = await requestAs(['chat:read'], path);

    expect(res.status).toBe(403);
  });

  it('accepts a key holding agent:read', async () => {
    const res = await requestAs(['agent:read'], path);

    expect(res.status).toBe(200);
  });
});
