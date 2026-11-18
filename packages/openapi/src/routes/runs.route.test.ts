import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route module pulls in the db graph (via the permission middleware) and the
// better-auth graph (via `requireAuth`) at import time. Both are stubbed; the
// permission middleware is NOT, so the API-key scope gates are exercised for real.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
// Mirrors the real gate: no authenticated principal, no access.
vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) =>
    c.get('userId') ? next() : c.json({ error: { code: 'unauthorized' } }, 401),
}));

const journal = { getStreamHistoryPage: vi.fn() };
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => journal,
}));

const notFound = () => Object.assign(new Error('Run not found'), { name: 'NotFoundError' });

const service = {
  cancelRun: vi.fn(),
  createRun: vi.fn(),
  getRun: vi.fn(),
  listInterventions: vi.fn(),
  listQueuedMessages: vi.fn(),
  queueMessage: vi.fn(),
  removeQueuedMessage: vi.fn(),
  requireRun: vi.fn(),
  resolveIntervention: vi.fn(),
  snapshot: vi.fn(),
  submitToolResults: vi.fn(),
};
const constructed: Array<{ userId: string | null; workspaceId?: string }> = [];
vi.mock('../services/run.service', () => ({
  RunRestService: class {
    constructor(_db: unknown, userId: string | null, workspaceId?: string) {
      constructed.push({ userId, workspaceId });
      return service;
    }
  },
  toRunToolCall: (tool: any) => ({ arguments: tool.arguments, id: tool.id, name: tool.apiName }),
}));

const { default: RunRoutes } = await import('./runs.route');

const FULL = ['run:write', 'model:invoke'];

/** A request authenticated as an API key holding exactly `scopes` (or none at all). */
const request = (
  path: string,
  init: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    scopes?: string[] | null;
    workspaceId?: string;
  } = {},
) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (init.scopes !== null) {
      c.set('userId' as never, 'user-1' as never);
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, (init.scopes ?? FULL) as never);
      if (init.workspaceId) c.set('workspaceId' as never, init.workspaceId as never);
    }
    await next();
  });
  app.route('/', RunRoutes);

  return app.request(path, {
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  constructed.length = 0;
});

describe('POST /runs', () => {
  const body = { agentId: 'agt-1', input: 'hello' };

  it('requires authentication', async () => {
    const res = await request('/', { body, method: 'POST', scopes: null });
    expect(res.status).toBe(401);
    expect(service.createRun).not.toHaveBeenCalled();
  });

  it('rejects a read-only key', async () => {
    const res = await request('/', { body, method: 'POST', scopes: ['run:read', 'model:invoke'] });
    expect(res.status).toBe(403);
  });

  it('rejects a run:write key that cannot invoke models', async () => {
    const res = await request('/', { body, method: 'POST', scopes: ['run:write'] });
    expect(res.status).toBe(403);
  });

  it('does not accept agent:write in place of run:write', async () => {
    const res = await request('/', {
      body,
      method: 'POST',
      scopes: ['agent:write', 'chat:write', 'model:invoke'],
    });
    expect(res.status).toBe(403);
  });

  it('starts the run and answers 202 in the request workspace', async () => {
    service.createRun.mockResolvedValue({
      id: 'op-1',
      scheduledAt: null,
      status: 'queued',
      topicId: 'tpc-1',
      userMessageId: 'msg-1',
    });

    const res = await request('/', { body, method: 'POST', workspaceId: 'ws-1' });

    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ id: 'op-1', status: 'queued' });
    expect(service.createRun).toHaveBeenCalledWith(body);
    expect(constructed[0]).toEqual({ userId: 'user-1', workspaceId: 'ws-1' });
  });

  it.each([
    ['neither agentId nor groupId', { input: 'hello' }],
    ['an empty input', { agentId: 'agt-1', input: '' }],
    [
      'function tools on a group run',
      { groupId: 'grp-1', input: 'hi', tools: [{ name: 'f', type: 'function' }] },
    ],
    [
      'a non-UTC scheduledAt',
      { agentId: 'agt-1', input: 'hi', scheduledAt: '2030-01-01T00:00:00+08:00' },
    ],
    [
      'a scheduled run on an existing topic',
      { agentId: 'agt-1', input: 'hi', scheduledAt: '2030-01-01T00:00:00Z', topicId: 'tpc-1' },
    ],
    ['an unknown field', { agentId: 'agt-1', input: 'hi', model: 'gpt-5' }],
  ])('rejects %s', async (_label, invalid) => {
    const res = await request('/', { body: invalid, method: 'POST' });
    expect(res.status).toBe(400);
    expect(service.createRun).not.toHaveBeenCalled();
  });

  it('maps a busy conversation to 409', async () => {
    service.createRun.mockRejectedValue(
      Object.assign(new Error('busy'), { name: 'ConflictError' }),
    );
    const res = await request('/', { body: { ...body, topicId: 'tpc-1' }, method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('GET /runs/:id', () => {
  it('requires a run scope', async () => {
    const res = await request('/op-1', { scopes: ['agent:read', 'chat:read'] });
    expect(res.status).toBe(403);
  });

  it('accepts run:read, and run:write implies it', async () => {
    service.getRun.mockResolvedValue({ id: 'op-1', status: 'running' });

    expect((await request('/op-1', { scopes: ['run:read'] })).status).toBe(200);
    expect((await request('/op-1', { scopes: ['run:write'] })).status).toBe(200);
    expect(service.getRun).toHaveBeenCalledWith('op-1');
  });

  it("answers 404 for someone else's run or a run of another workspace", async () => {
    service.getRun.mockRejectedValue(notFound());
    const res = await request('/op-other', { scopes: ['run:read'], workspaceId: 'ws-2' });
    expect(res.status).toBe(404);
    expect(constructed[0].workspaceId).toBe('ws-2');
  });
});

describe('GET /runs/:id/events', () => {
  const page = (events: any[], nextCursor: string) => ({
    available: true,
    events,
    hasMore: false,
    nextCursor,
  });

  it('streams journal events as typed SSE and closes on the terminal event', async () => {
    service.requireRun.mockResolvedValue({ id: 'op-1' });
    service.snapshot.mockResolvedValue({
      interventions: [],
      run: { result: { content: 'Done.', messageId: 'msg-2' }, status: 'completed' },
    });
    journal.getStreamHistoryPage.mockResolvedValueOnce(
      page(
        [
          { data: {}, id: '1-0', stepIndex: 0, timestamp: 1, type: 'agent_runtime_init' },
          {
            data: { chunkType: 'text', content: 'Do' },
            id: '2-0',
            stepIndex: 0,
            timestamp: 2,
            type: 'stream_chunk',
          },
          { data: {}, id: '3-0', stepIndex: 0, timestamp: 3, type: 'message_patch' },
          {
            data: { reason: 'completed' },
            id: '4-0',
            stepIndex: 0,
            timestamp: 4,
            type: 'agent_runtime_end',
          },
        ],
        '4-0',
      ),
    );

    const res = await request('/op-1/events', { scopes: ['run:read'] });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: run.started\ndata: ');
    expect(text).toContain('id: 2-0');
    expect(text).toContain('"type":"message.delta"');
    expect(text).toContain('"delta":"Do"');
    expect(text).not.toContain('message_patch');
    expect(text).toContain('event: run.completed');
    expect(text).toContain('"content":"Done."');
    expect(journal.getStreamHistoryPage).toHaveBeenCalledWith('op-1', '0', 200);
  });

  it('resumes after Last-Event-ID', async () => {
    service.requireRun.mockResolvedValue({ id: 'op-1' });
    service.snapshot.mockResolvedValue({ interventions: [], run: { status: 'cancelled' } });
    journal.getStreamHistoryPage.mockResolvedValue(page([], '7-0'));

    const res = await request('/op-1/events', {
      headers: { 'Last-Event-ID': '7-0' },
      scopes: ['run:read'],
    });
    const text = await res.text();

    expect(journal.getStreamHistoryPage).toHaveBeenNthCalledWith(1, 'op-1', '7-0', 200);
    expect(text).toContain('event: run.cancelled');
  });

  it('rejects a Last-Event-ID the journal never issued', async () => {
    const res = await request('/op-1/events', {
      headers: { 'Last-Event-ID': 'bogus' },
      scopes: ['run:read'],
    });
    expect(res.status).toBe(400);
  });

  it('refuses before streaming when the run is not visible', async () => {
    service.requireRun.mockRejectedValue(notFound());
    const res = await request('/op-1/events', { scopes: ['run:read'] });
    expect(res.status).toBe(404);
    expect(journal.getStreamHistoryPage).not.toHaveBeenCalled();
  });
});

describe('POST /runs/:id/cancel', () => {
  it('needs run:write but not model:invoke', async () => {
    service.cancelRun.mockResolvedValue({ cancelled: true, id: 'op-1', status: 'cancelled' });

    expect((await request('/op-1/cancel', { method: 'POST', scopes: ['run:read'] })).status).toBe(
      403,
    );
    const res = await request('/op-1/cancel', { method: 'POST', scopes: ['run:write'] });
    expect(res.status).toBe(200);
    expect(service.cancelRun).toHaveBeenCalledWith('op-1');
  });

  it("answers 404 for someone else's run", async () => {
    service.cancelRun.mockRejectedValue(notFound());
    expect((await request('/op-1/cancel', { method: 'POST' })).status).toBe(404);
  });
});

describe('interventions', () => {
  it('lists with run:read', async () => {
    service.listInterventions.mockResolvedValue({ items: [] });
    const res = await request('/op-1/interventions', { scopes: ['run:read'] });
    expect(res.status).toBe(200);
  });

  it('resolves an approval', async () => {
    service.resolveIntervention.mockResolvedValue({
      continuedByRunId: 'op-2',
      interventionId: 'call-1',
    });
    const res = await request('/op-1/interventions/call-1', {
      body: { action: 'approve' },
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.continuedByRunId).toBe('op-2');
    expect(service.resolveIntervention).toHaveBeenCalledWith('op-1', 'call-1', {
      action: 'approve',
    });
  });

  it('needs model:invoke to resume the run', async () => {
    const res = await request('/op-1/interventions/call-1', {
      body: { action: 'approve' },
      method: 'POST',
      scopes: ['run:write'],
    });
    expect(res.status).toBe(403);
  });

  it.each([
    ['an unknown action', { action: 'maybe' }],
    ['an answer without content', { action: 'answer' }],
    ['fields of another action', { action: 'approve', reason: 'no' }],
  ])('rejects %s', async (_label, invalid) => {
    const res = await request('/op-1/interventions/call-1', { body: invalid, method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('POST /runs/:id/tool-results', () => {
  it('rejects an empty result list', async () => {
    const res = await request('/op-1/tool-results', { body: { results: [] }, method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('hands the results to the run', async () => {
    service.submitToolResults.mockResolvedValue({ callIds: ['c1'], id: 'op-1', state: 'resumed' });
    const body = { results: [{ callId: 'c1', output: '42' }] };
    const res = await request('/op-1/tool-results', { body, method: 'POST' });
    expect(res.status).toBe(200);
    expect(service.submitToolResults).toHaveBeenCalledWith('op-1', body);
  });

  it('maps a run that is not waiting to 409', async () => {
    service.submitToolResults.mockRejectedValue(
      Object.assign(new Error('not waiting'), { name: 'ConflictError' }),
    );
    const res = await request('/op-1/tool-results', {
      body: { results: [{ callId: 'c1', output: '42' }] },
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });
});

describe('queued messages', () => {
  it('queues a message with 202', async () => {
    service.queueMessage.mockResolvedValue({ id: 'm1', length: 1, state: 'queued' });
    const res = await request('/op-1/messages', {
      body: { content: 'also check X', id: 'm1' },
      method: 'POST',
    });
    expect(res.status).toBe(202);
    expect(service.queueMessage).toHaveBeenCalledWith('op-1', {
      content: 'also check X',
      id: 'm1',
    });
  });

  it('rejects an id that is not delimiter-safe', async () => {
    const res = await request('/op-1/messages', {
      body: { content: 'x', id: 'a b' },
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('lists with run:read and withdraws with run:write', async () => {
    service.listQueuedMessages.mockResolvedValue({ items: [] });
    service.removeQueuedMessage.mockResolvedValue({ id: 'm1', removed: true, state: 'removed' });

    expect((await request('/op-1/messages', { scopes: ['run:read'] })).status).toBe(200);
    expect(
      (await request('/op-1/messages/m1', { method: 'DELETE', scopes: ['run:read'] })).status,
    ).toBe(403);
    const res = await request('/op-1/messages/m1', { method: 'DELETE', scopes: ['run:write'] });
    expect(res.status).toBe(200);
    expect(service.removeQueuedMessage).toHaveBeenCalledWith('op-1', 'm1');
  });
});

/** Every endpoint, with the service method behind it and a valid body. */
const ENDPOINTS = [
  {
    body: { agentId: 'agt-1', input: 'hi' },
    method: 'POST',
    path: '/',
    serviceMethod: 'createRun',
  },
  { method: 'GET', path: '/op-1', serviceMethod: 'getRun' },
  { method: 'GET', path: '/op-1/events', serviceMethod: 'requireRun' },
  { method: 'POST', path: '/op-1/cancel', serviceMethod: 'cancelRun' },
  { method: 'GET', path: '/op-1/interventions', serviceMethod: 'listInterventions' },
  {
    body: { action: 'approve' },
    method: 'POST',
    path: '/op-1/interventions/call-1',
    serviceMethod: 'resolveIntervention',
  },
  {
    body: { results: [{ callId: 'c1', output: '42' }] },
    method: 'POST',
    path: '/op-1/tool-results',
    serviceMethod: 'submitToolResults',
  },
  {
    body: { content: 'more' },
    method: 'POST',
    path: '/op-1/messages',
    serviceMethod: 'queueMessage',
  },
  { method: 'GET', path: '/op-1/messages', serviceMethod: 'listQueuedMessages' },
  { method: 'DELETE', path: '/op-1/messages/m1', serviceMethod: 'removeQueuedMessage' },
] as const;

const label = (endpoint: (typeof ENDPOINTS)[number]) => `${endpoint.method} ${endpoint.path}`;

describe('every /runs endpoint', () => {
  it.each(ENDPOINTS.map((endpoint) => [label(endpoint), endpoint] as const))(
    '%s answers 401 without credentials',
    async (_label, { body, method, path, serviceMethod }) => {
      const res = await request(path, { body, method, scopes: null });
      expect(res.status).toBe(401);
      expect(service[serviceMethod]).not.toHaveBeenCalled();
    },
  );

  it.each(ENDPOINTS.map((endpoint) => [label(endpoint), endpoint] as const))(
    '%s answers 403 to a key without run scopes',
    async (_label, { body, method, path, serviceMethod }) => {
      const res = await request(path, {
        body,
        method,
        scopes: ['agent:write', 'chat:write', 'model:invoke'],
      });
      expect(res.status).toBe(403);
      expect(service[serviceMethod]).not.toHaveBeenCalled();
    },
  );

  it.each(
    ENDPOINTS.filter(({ path }) => path !== '/').map(
      (endpoint) => [label(endpoint), endpoint] as const,
    ),
  )(
    "%s answers 404 for another user's run, or one in another workspace",
    async (_label, { body, method, path, serviceMethod }) => {
      service[serviceMethod].mockRejectedValue(notFound());
      const res = await request(path, { body, method, workspaceId: 'ws-2' });
      expect(res.status).toBe(404);
      expect(constructed.at(-1)).toEqual({ userId: 'user-1', workspaceId: 'ws-2' });
    },
  );

  it.each([
    [
      'GET /op-1/events with an `after` that is not an event id',
      'GET',
      '/op-1/events?after=bogus',
      undefined,
    ],
    ['POST /op-1/messages without content', 'POST', '/op-1/messages', {}],
    [
      'POST /op-1/tool-results with a result missing its callId',
      'POST',
      '/op-1/tool-results',
      { results: [{ output: 'x' }] },
    ],
  ] as const)('%s answers 400', async (_label, method, path, body) => {
    const res = await request(path, { body, method });
    expect(res.status).toBe(400);
  });
});
