import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { idempotencyMiddleware } from './idempotency';

const store = vi.hoisted(() => new Map<string, any>());
const openapi = vi.hoisted(() => ({
  claimIdempotency: vi.fn(
    async (scope: { fingerprint: string; keyHash: string; userId: string }) => {
      const key = `${scope.userId}:${scope.keyHash}`;
      const entry = store.get(key);
      if (!entry) {
        store.set(key, { fingerprint: scope.fingerprint, state: 'pending' });
        return { state: 'claimed', token: `t-${key}` };
      }
      const sameRequest = entry.fingerprint === scope.fingerprint;
      return entry.state === 'completed'
        ? { response: entry.response, sameRequest, state: 'completed' }
        : { sameRequest, state: 'pending' };
    },
  ),
  completeIdempotency: vi.fn(async (scope: any, response: any) => {
    store.set(`${scope.userId}:${scope.keyHash}`, {
      fingerprint: scope.fingerprint,
      response,
      state: 'completed',
    });
  }),
  releaseIdempotency: vi.fn(async (scope: any) => {
    store.delete(`${scope.userId}:${scope.keyHash}`);
  }),
}));
vi.mock('@/server/services/redis', () => ({ redisService: { openapi } }));

let created = 0;

interface Caller {
  apiKeyId?: string;
  userId?: string | null;
  workspaceId?: string;
}

const createApp = ({ apiKeyId = 'key-1', userId = 'user-1', workspaceId }: Caller = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('authType', 'apikey');
    c.set('authData', { apiKeyId });
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.use('*', idempotencyMiddleware);
  app.post('/items', async (c) => {
    created += 1;
    const body = await c.req.json();
    return c.json({ data: { id: `item_${created}`, ...body }, success: true }, 201);
  });
  app.post('/fail', (c) => c.json({ success: false }, 500));
  app.post('/stream', (c) => streamSSE(c, async (stream) => stream.writeSSE({ data: 'x' })));
  app.post('/slow', async (c) => {
    // A concurrent replay arrives while this one is still in flight.
    const replay = await app.request('/slow', post({}, 'k-slow'));
    return c.json({ replayStatus: replay.status, replayBody: await replay.json() });
  });
  return app;
};

const post = (body: unknown, key?: string, headers: Record<string, string> = {}) => ({
  body: JSON.stringify(body),
  headers: {
    'Content-Type': 'application/json',
    ...(key === undefined ? {} : { 'Idempotency-Key': key }),
    ...headers,
  },
  method: 'POST',
});

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    store.clear();
    created = 0;
    vi.clearAllMocks();
  });

  it('replays the first response for a retry with the same key and request', async () => {
    const app = createApp();

    const first = await app.request('/items', post({ name: 'a' }, 'k1'));
    const retry = await app.request('/items', post({ name: 'a' }, 'k1'));

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(await first.json());
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    expect(created).toBe(1);
  });

  it('runs every request that carries no key', async () => {
    const app = createApp();
    await app.request('/items', post({ name: 'a' }));
    await app.request('/items', post({ name: 'a' }));
    expect(created).toBe(2);
    expect(openapi.claimIdempotency).not.toHaveBeenCalled();
  });

  it('scopes keys to the user', async () => {
    await createApp({ userId: 'user-1' }).request('/items', post({ name: 'a' }, 'k1'));
    await createApp({ userId: 'user-2' }).request('/items', post({ name: 'a' }, 'k1'));
    expect(created).toBe(2);
  });

  it('never replays across API keys or workspaces of the same user', async () => {
    const first = await createApp().request('/items', post({ name: 'a' }, 'k1'));
    // A second (e.g. scope-restricted) key must go through its own route guards,
    // not receive the first key's stored response.
    const otherKey = await createApp({ apiKeyId: 'key-2' }).request(
      '/items',
      post({ name: 'a' }, 'k1'),
    );
    const otherWorkspace = await createApp({ workspaceId: 'ws-1' }).request(
      '/items',
      post({ name: 'a' }, 'k1'),
    );

    expect(otherKey.headers.get('Idempotent-Replayed')).toBeNull();
    expect(otherWorkspace.headers.get('Idempotent-Replayed')).toBeNull();
    expect(await otherKey.json()).not.toEqual(await first.json());
    expect(created).toBe(3);
  });

  it('answers 422 idempotency_conflict when the key is reused for a different request', async () => {
    const app = createApp();
    await app.request('/items', post({ name: 'a' }, 'k1'));

    for (const [path, init] of [
      ['/items', post({ name: 'b' }, 'k1')],
      ['/items?dryRun=true', post({ name: 'a' }, 'k1')],
    ] as const) {
      const response = await app.request(path, init);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: 'idempotency_conflict' });
    }
    expect(created).toBe(1);
  });

  it('answers 409 idempotency_conflict while the first request is still running', async () => {
    const response = await createApp().request('/slow', post({}, 'k-slow'));
    const body = await response.json();
    expect(body.replayStatus).toBe(409);
    expect(body.replayBody).toMatchObject({ code: 'idempotency_conflict', success: false });
  });

  it('frees the key after a server error or a stream so the client can retry', async () => {
    const app = createApp();
    await app.request('/fail', post({}, 'k-fail'));
    await app.request('/stream', post({}, 'k-stream'));

    expect(openapi.completeIdempotency).not.toHaveBeenCalled();
    expect(openapi.releaseIdempotency).toHaveBeenCalledTimes(2);
    expect(openapi.releaseIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.stringMatching(/^t-/) }),
    );
    expect(store.size).toBe(0);
  });

  it('rejects an over-long key with validation_error', async () => {
    const response = await createApp().request('/items', post({}, 'x'.repeat(256)));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validation_error',
      details: [{ path: 'header.Idempotency-Key' }],
    });
  });

  it('runs the request unguarded when Redis is unavailable', async () => {
    openapi.claimIdempotency.mockResolvedValueOnce(undefined as never);
    const response = await createApp().request('/items', post({ name: 'a' }, 'k1'));
    expect(response.status).toBe(201);
    expect(openapi.completeIdempotency).not.toHaveBeenCalled();
  });

  it('keeps the handler answer when storing it fails', async () => {
    openapi.completeIdempotency.mockRejectedValueOnce(new Error('down'));
    const response = await createApp().request('/items', post({ name: 'a' }, 'k1'));
    expect(response.status).toBe(201);
    expect(openapi.releaseIdempotency).toHaveBeenCalled();
  });
});
