// @vitest-environment node
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End to end over `/api/v1/webhooks`: the real `userAuthMiddleware` +
 * `workspaceAuthMiddleware` against `api_keys` rows on PGlite, the real scope
 * gates, controller, `WebhookRestService`, `DeveloperWebhookService`, model and
 * KeyVaults gatekeeper. Only the outside world is stubbed: the delivery queue
 * (`DeveloperWebhookWorkflow.triggerDeliver`) and the outbound HTTP request.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
process.env.CLOUD_DATABASE_URL ??= 'postgresql://mock:mock@localhost:5432/mock';
process.env.QSTASH_TOKEN ??= 'mock-qstash-token';

const holder = vi.hoisted(() => ({
  fetch: vi.fn(),
  serverDB: undefined as unknown,
  triggerDeliver: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.serverDB }));
vi.mock('@/server/workflows/developerWebhook', () => ({
  DeveloperWebhookWorkflow: { triggerDeliver: holder.triggerDeliver },
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  isSSRFBlockedError: () => false,
  ssrfSafeFetch: holder.fetch,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, webhookDeliveries, webhookEndpoints, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { DeletedResourceSchema } = await import('../types/common.type');
const {
  WebhookDeliveryListResponseSchema,
  WebhookDeliverySchema,
  WebhookListResponseSchema,
  WebhookSchema,
  WebhookWithSecretSchema,
} = await import('../types/webhook.type');
const WebhookRoutes = (await import('./webhooks.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/webhooks', WebhookRoutes);
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);

const OWNER = 'webhook-route-owner';
const STRANGER = 'webhook-route-stranger';
const WORKSPACE = 'webhook-route-ws';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const WRITE_KEY = 'sk-lh-whkwriteowner001';
const READ_KEY = 'sk-lh-whkreadowner0001';
const OTHER_SCOPE_KEY = 'sk-lh-whkchatowner0001';
const STRANGER_KEY = 'sk-lh-whkstranger00001';
const WORKSPACE_KEY = 'sk-lh-whkworkspace0001';
const CHAT_EVENTS_KEY = 'sk-lh-whkchatevents001';
const CHAT_READER_KEY = 'sk-lh-whkchatreader001';
const FILE_EVENTS_KEY = 'sk-lh-whkfileevents001';
const BOTH_DOMAINS_KEY = 'sk-lh-whkbothdomains01';

const call = (
  path: string,
  init: { body?: unknown; headers?: Record<string, string>; key?: string; method?: string } = {},
) =>
  app.request(`/api/v1/webhooks${path}`, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...init.headers,
    },
    method: init.method ?? 'GET',
  });

const data = async (res: Response) => ((await res.json()) as { data: any }).data;

const VALID = {
  description: 'CI hook',
  events: ['run.completed', 'run.failed'],
  url: 'https://example.com/hook',
};

const create = async (key = WRITE_KEY, headers?: Record<string, string>) => {
  const res = await call('', { body: VALID, headers, key, method: 'POST' });
  expect(res.status).toBe(201);
  return WebhookWithSecretSchema.parse(await data(res));
};

const clean = async () => {
  await serverDB.delete(webhookDeliveries);
  await serverDB.delete(webhookEndpoints);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  holder.fetch.mockReset();
  holder.triggerDeliver.mockReset();
  await clean();

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'WS', primaryOwnerId: OWNER, slug: 'webhook-route-ws' });
  await serverDB
    .insert(workspaceMembers)
    .values({ role: 'owner', userId: OWNER, workspaceId: WORKSPACE });

  const key = (k: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: k,
    keyHash: hashApiKey(k),
    name: k,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB.insert(apiKeys).values([
    // Subscribing to run.* also takes run:read (the events carry run data).
    key(WRITE_KEY, OWNER, ['webhook:write', 'run:read']),
    key(READ_KEY, OWNER, ['webhook:read']),
    key(OTHER_SCOPE_KEY, OWNER, ['chat:read', 'chat:write']),
    key(STRANGER_KEY, STRANGER, ['webhook:write', 'run:read']),
    key(WORKSPACE_KEY, OWNER, ['webhook:write', 'run:read'], WORKSPACE),
    key(CHAT_EVENTS_KEY, OWNER, ['webhook:write', 'chat:read']),
    key(CHAT_READER_KEY, OWNER, ['webhook:read', 'chat:read']),
    // May manage webhooks and read files, but not chat data.
    key(FILE_EVENTS_KEY, OWNER, ['webhook:write', 'file:read']),
    key(BOTH_DOMAINS_KEY, OWNER, ['webhook:write', 'chat:read', 'file:read']),
  ]);
});

afterAll(clean);

/** Every operation, with a path that addresses an endpoint (`:id`) and a delivery where needed. */
const operations = (id: string, deliveryId = 'whd_missing') => [
  { method: 'GET', path: '', scope: 'read' },
  { body: VALID, method: 'POST', path: '', scope: 'write' },
  { method: 'GET', path: `/${id}`, scope: 'read' },
  { body: { enabled: false }, method: 'PATCH', path: `/${id}`, scope: 'write' },
  { method: 'DELETE', path: `/${id}`, scope: 'write' },
  { method: 'POST', path: `/${id}/rotate-secret`, scope: 'write' },
  { method: 'POST', path: `/${id}/test`, scope: 'write' },
  { method: 'GET', path: `/${id}/deliveries`, scope: 'read' },
  { method: 'POST', path: `/${id}/deliveries/${deliveryId}/redeliver`, scope: 'write' },
];

describe('webhook routes: authentication and scopes', () => {
  it('answers 401 without an API key on every operation', async () => {
    for (const op of operations('whk_any')) {
      const res = await call(op.path, { body: op.body, method: op.method });
      expect(res.status, `${op.method} ${op.path}`).toBe(401);
    }
  });

  it('answers 403 insufficient_scope to a key without webhook scopes on every operation', async () => {
    const { id } = await create();
    for (const op of operations(id)) {
      const res = await call(op.path, { body: op.body, key: OTHER_SCOPE_KEY, method: op.method });
      expect(res.status, `${op.method} ${op.path}`).toBe(403);
      expect(((await res.json()) as { message: string }).message).toContain('webhook:');
    }
  });

  it('lets a webhook:read key read but not write', async () => {
    const { id } = await create();
    for (const op of operations(id)) {
      const res = await call(op.path, { body: op.body, key: READ_KEY, method: op.method });
      if (op.scope === 'read') expect(res.status, `${op.method} ${op.path}`).toBe(200);
      else expect(res.status, `${op.method} ${op.path}`).toBe(403);
    }
  });
});

describe('webhook routes: event subscriptions need the read scope of their data', () => {
  it('refuses events whose domain the key cannot read, on create and on update', async () => {
    const refused = await call('', {
      body: { ...VALID, events: ['message.created', 'run.completed'] },
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { code: string; message: string };
    expect(body.code).toBe('insufficient_scope');
    expect(body.message).toContain('`chat:read`');

    const { id } = await create();
    const patch = await call(`/${id}`, {
      body: { events: ['task.status_changed'] },
      key: WRITE_KEY,
      method: 'PATCH',
    });
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as { message: string }).message).toContain('`agent:read`');
  });

  it('accepts them once the key holds that scope', async () => {
    const res = await call('', {
      body: { ...VALID, events: ['message.created', 'topic.created'] },
      key: CHAT_EVENTS_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(201);
  });
});

/** An endpoint carrying `message.created`, registered by a key that may read chat data. */
const createChatEndpoint = async () => {
  const res = await call('', {
    body: { ...VALID, events: ['message.created'] },
    key: CHAT_EVENTS_KEY,
    method: 'POST',
  });
  expect(res.status).toBe(201);
  return WebhookWithSecretSchema.parse(await data(res));
};

const storedEndpoint = async (id: string) =>
  (await serverDB.select().from(webhookEndpoints)).find((row) => row.id === id)!;

describe('webhook routes: a PATCH without events is judged on the events the endpoint keeps', () => {
  // WRITE_KEY may manage webhooks and read runs, but not chat data.
  it('refuses to point a chat endpoint at another URL, and changes nothing', async () => {
    const { id } = await createChatEndpoint();
    const res = await call(`/${id}`, {
      body: { url: 'https://attacker.example.com/hook' },
      key: WRITE_KEY,
      method: 'PATCH',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toContain('`chat:read`');
    expect((await storedEndpoint(id)).url).toBe(VALID.url);
  });

  it('refuses to turn a chat endpoint back on, and changes nothing', async () => {
    const { id } = await createChatEndpoint();
    await call(`/${id}`, { body: { enabled: false }, key: CHAT_EVENTS_KEY, method: 'PATCH' });

    const res = await call(`/${id}`, { body: { enabled: true }, key: WRITE_KEY, method: 'PATCH' });
    expect(res.status).toBe(403);
    expect((await storedEndpoint(id)).enabled).toBe(false);
  });

  it('still allows renaming or turning it off, which moves no data anywhere', async () => {
    const { id } = await createChatEndpoint();
    const rename = await call(`/${id}`, {
      body: { description: 'renamed' },
      key: WRITE_KEY,
      method: 'PATCH',
    });
    expect(rename.status).toBe(200);
    const off = await call(`/${id}`, { body: { enabled: false }, key: WRITE_KEY, method: 'PATCH' });
    expect(off.status).toBe(200);
    expect(await storedEndpoint(id)).toMatchObject({ description: 'renamed', enabled: false });
  });
});

describe('webhook routes: the delivery log reveals only events the key may read', () => {
  const seedDeliveries = async (endpointId: string) => {
    const envelope = (id: string, type: string, payloadData: object) => ({
      createdAt: '2026-11-18T00:00:00.000Z',
      data: payloadData,
      id,
      type,
      workspaceId: null,
    });
    const rows = [
      {
        eventId: 'evt_chat',
        eventType: 'message.created' as const,
        id: 'whd_chat',
        payload: envelope('evt_chat', 'message.created', {
          agentId: null,
          messageId: 'msg_secret',
          role: 'user',
          threadId: null,
          topicId: 'tpc_secret',
        }),
      },
      {
        eventId: 'evt_test',
        eventType: 'webhook.test' as const,
        id: 'whd_test',
        payload: envelope('evt_test', 'webhook.test', { message: 'hi', webhookId: endpointId }),
      },
    ];
    await serverDB.insert(webhookDeliveries).values(
      rows.map((row, index) => ({
        ...row,
        createdAt: new Date(Date.UTC(2026, 10, 18, 0, 0, index)),
        endpointId,
        payload: row.payload as never,
        status: 'succeeded' as const,
        userId: OWNER,
      })),
    );
  };

  it('hides chat deliveries from a webhook:read key without chat:read', async () => {
    const { id } = await createChatEndpoint();
    await seedDeliveries(id);

    const restricted = await data(await call(`/${id}/deliveries`, { key: READ_KEY }));
    expect(restricted.items.map((d: { id: string }) => d.id)).toEqual(['whd_test']);
    expect(restricted.total).toBe(1);
    expect(JSON.stringify(restricted)).not.toContain('msg_secret');

    const reader = await data(await call(`/${id}/deliveries`, { key: CHAT_READER_KEY }));
    expect(reader.items.map((d: { id: string }) => d.id)).toEqual(['whd_test', 'whd_chat']);
    expect(reader.total).toBe(2);
  });

  it('refuses to redeliver an event the key may not read', async () => {
    const { id } = await createChatEndpoint();
    await seedDeliveries(id);

    const refused = await call(`/${id}/deliveries/whd_chat/redeliver`, {
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('insufficient_scope');
    expect(holder.triggerDeliver).not.toHaveBeenCalled();

    const allowed = await call(`/${id}/deliveries/whd_test/redeliver`, {
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(allowed.status).toBe(202);
  });
});

describe('webhook routes: a redelivery does not ride a redirect', () => {
  const seedChatDelivery = async (endpointId: string) => {
    await serverDB.insert(webhookDeliveries).values({
      createdAt: new Date(Date.UTC(2026, 10, 18, 0, 0, 0)),
      endpointId,
      eventId: 'evt_chat',
      eventType: 'message.created',
      id: 'whd_chat',
      payload: {
        createdAt: '2026-11-18T00:00:00.000Z',
        data: {
          agentId: null,
          messageId: 'msg_secret',
          role: 'user',
          threadId: null,
          topicId: 'tpc_secret',
        },
        id: 'evt_chat',
        type: 'message.created',
        workspaceId: null,
      } as never,
      status: 'succeeded',
      userId: OWNER,
    });
  };

  const deliveryRows = async (endpointId: string) =>
    (await serverDB.select().from(webhookDeliveries)).filter(
      (row) => row.endpointId === endpointId,
    );

  it('refuses to replay a payload the endpoint no longer subscribes to', async () => {
    const { id } = await createChatEndpoint();
    await seedChatDelivery(id);

    // BOTH_DOMAINS_KEY may read chat and file data, so this redirect is authorized…
    const redirect = await call(`/${id}`, {
      body: { events: ['file.parsed'], url: 'https://attacker.example.com/hook' },
      key: BOTH_DOMAINS_KEY,
      method: 'PATCH',
    });
    expect(redirect.status).toBe(200);
    expect(await storedEndpoint(id)).toMatchObject({
      events: ['file.parsed'],
      url: 'https://attacker.example.com/hook',
    });

    // …but the stored chat payload no longer has a subscription to ride on.
    const replayed = await call(`/${id}/deliveries/whd_chat/redeliver`, {
      key: BOTH_DOMAINS_KEY,
      method: 'POST',
    });
    expect(replayed.status).toBe(409);
    expect(await deliveryRows(id)).toHaveLength(1);
    expect(holder.triggerDeliver).not.toHaveBeenCalled();
  });

  it('refuses to queue anything to an endpoint that was turned off', async () => {
    const { id } = await createChatEndpoint();
    await seedChatDelivery(id);
    await call(`/${id}`, { body: { enabled: false }, key: CHAT_EVENTS_KEY, method: 'PATCH' });

    const replayed = await call(`/${id}/deliveries/whd_chat/redeliver`, {
      key: CHAT_EVENTS_KEY,
      method: 'POST',
    });
    expect(replayed.status).toBe(409);
    expect(await deliveryRows(id)).toHaveLength(1);
    expect(holder.triggerDeliver).not.toHaveBeenCalled();
  });

  it('still replays when the endpoint stayed put', async () => {
    const { id } = await createChatEndpoint();
    await seedChatDelivery(id);

    const replayed = await call(`/${id}/deliveries/whd_chat/redeliver`, {
      key: CHAT_EVENTS_KEY,
      method: 'POST',
    });
    expect(replayed.status).toBe(202);
    expect(WebhookDeliverySchema.parse(await data(replayed)).redeliveryOf).toBe('whd_chat');
    expect(await deliveryRows(id)).toHaveLength(2);
  });
});

describe('webhook routes: isolation', () => {
  it("answers 404 for another user's webhook on every addressed operation", async () => {
    const { id } = await create();
    for (const op of operations(id).filter(({ path }) => path !== '')) {
      const res = await call(op.path, { body: op.body, key: STRANGER_KEY, method: op.method });
      expect(res.status, `${op.method} ${op.path}`).toBe(404);
    }
    const list = await call('', { key: STRANGER_KEY });
    expect((await data(list)).items).toEqual([]);
  });

  it('keeps personal and workspace endpoints apart, both ways', async () => {
    const personal = await create();
    const workspace = await create(WORKSPACE_KEY);
    expect(workspace.workspaceId).toBe(WORKSPACE);
    expect(personal.workspaceId).toBeNull();

    for (const op of operations(personal.id).filter(({ path }) => path !== '')) {
      const res = await call(op.path, { body: op.body, key: WORKSPACE_KEY, method: op.method });
      expect(res.status, `workspace key ${op.method} ${op.path}`).toBe(404);
    }
    for (const op of operations(workspace.id).filter(({ path }) => path !== '')) {
      const res = await call(op.path, { body: op.body, key: WRITE_KEY, method: op.method });
      expect(res.status, `personal key ${op.method} ${op.path}`).toBe(404);
    }

    const personalList = WebhookListResponseSchema.parse(
      await data(await call('', { key: WRITE_KEY })),
    );
    expect(personalList.items.map(({ id }) => id)).toEqual([personal.id]);
    const workspaceList = WebhookListResponseSchema.parse(
      await data(await call('', { key: WORKSPACE_KEY })),
    );
    expect(workspaceList.items.map(({ id }) => id)).toEqual([workspace.id]);
  });

  it('refuses a personal key that names a workspace', async () => {
    const res = await call('', { headers: { 'X-Workspace-Id': WORKSPACE }, key: WRITE_KEY });
    expect(res.status).toBe(403);
  });
});

describe('webhook routes: validation', () => {
  it.each([
    ['a non-URL', { ...VALID, url: 'not a url' }],
    ['a non-http URL', { ...VALID, url: 'ftp://example.com/hook' }],
    ['an over-long URL', { ...VALID, url: `https://example.com/${'a'.repeat(2048)}` }],
    ['an empty event list', { ...VALID, events: [] }],
    ['an unknown event', { ...VALID, events: ['run.exploded'] }],
    ['the test event', { ...VALID, events: ['webhook.test'] }],
    ['a long description', { ...VALID, description: 'x'.repeat(501) }],
    ['an unknown field', { ...VALID, secret: 'mine' }],
  ])('rejects %s on create with 400', async (_, body) => {
    const res = await call('', { body, key: WRITE_KEY, method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('rejects an empty or invalid update with 400', async () => {
    const { id } = await create();
    for (const body of [{}, { url: 'javascript:alert(1)' }, { events: [] }, { enabled: 'yes' }]) {
      const res = await call(`/${id}`, { body, key: WRITE_KEY, method: 'PATCH' });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 409 past the per-space endpoint limit', async () => {
    for (let i = 0; i < 20; i++) await create();
    const res = await call('', { body: VALID, key: WRITE_KEY, method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('webhook routes: happy paths', () => {
  it('creates, reads, lists, updates, rotates and deletes an endpoint', async () => {
    const created = await create();
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.secretHint).toBe(created.secret.slice(-4));
    expect(created).toMatchObject({
      consecutiveFailures: 0,
      description: 'CI hook',
      disabledReason: null,
      enabled: true,
      events: ['run.completed', 'run.failed'],
      url: VALID.url,
      workspaceId: null,
    });

    const got = WebhookSchema.parse(await data(await call(`/${created.id}`, { key: READ_KEY })));
    expect(got).not.toHaveProperty('secret');
    expect(got.id).toBe(created.id);

    const list = WebhookListResponseSchema.parse(
      await data(await call('?limit=1', { key: READ_KEY })),
    );
    expect(list).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });

    const disabled = await call(`/${created.id}`, {
      body: { enabled: false, events: ['run.started', 'run.started'] },
      key: WRITE_KEY,
      method: 'PATCH',
    });
    expect(disabled.status).toBe(200);
    expect(WebhookSchema.parse(await data(disabled))).toMatchObject({
      disabledReason: 'manual',
      enabled: false,
      events: ['run.started'],
    });

    const rotated = await call(`/${created.id}/rotate-secret`, { key: WRITE_KEY, method: 'POST' });
    expect(rotated.status).toBe(200);
    const { secret } = WebhookWithSecretSchema.parse(await data(rotated));
    expect(secret).not.toBe(created.secret);

    const deleted = await call(`/${created.id}`, { key: WRITE_KEY, method: 'DELETE' });
    expect(DeletedResourceSchema.parse(await data(deleted))).toEqual({
      deleted: true,
      id: created.id,
    });
    expect((await call(`/${created.id}`, { key: READ_KEY })).status).toBe(404);
  });

  it('sends a signed test event, lists it, and redelivers it', async () => {
    holder.fetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const { id, secret } = await create();

    const tested = await call(`/${id}/test`, { key: WRITE_KEY, method: 'POST' });
    expect(tested.status).toBe(200);
    const delivery = WebhookDeliverySchema.parse(await data(tested));
    expect(delivery).toMatchObject({
      attempts: 1,
      eventType: 'webhook.test',
      responseBody: 'ok',
      responseStatus: 200,
      status: 'succeeded',
      webhookId: id,
    });
    expect(delivery.payload).toMatchObject({ data: { webhookId: id }, type: 'webhook.test' });

    // The request carried the documented headers and a valid signature.
    const [url, init] = holder.fetch.mock.calls[0];
    expect(url).toBe(VALID.url);
    const { createHmac } = await import('node:crypto');
    const timestamp = init.headers['X-LobeHub-Timestamp'];
    expect(init.headers['X-LobeHub-Signature']).toBe(
      `v1=${createHmac('sha256', secret).update(`${timestamp}.${init.body}`).digest('hex')}`,
    );
    expect(init.headers['X-LobeHub-Event-Type']).toBe('webhook.test');
    expect(init.headers['X-LobeHub-Event-Id']).toBe(delivery.eventId);
    expect(init.headers['X-LobeHub-Delivery-Id']).toBe(delivery.id);

    const list = WebhookDeliveryListResponseSchema.parse(
      await data(await call(`/${id}/deliveries`, { key: READ_KEY })),
    );
    expect(list.items.map(({ id }) => id)).toEqual([delivery.id]);

    const redelivered = await call(`/${id}/deliveries/${delivery.id}/redeliver`, {
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(redelivered.status).toBe(202);
    const copy = WebhookDeliverySchema.parse(await data(redelivered));
    expect(copy).toMatchObject({
      eventId: delivery.eventId,
      redeliveryOf: delivery.id,
      status: 'pending',
    });
    expect(holder.triggerDeliver).toHaveBeenCalledWith({ deliveryId: copy.id, endpointId: id });
  });

  it('reports a failed test attempt on the delivery, not as an error status', async () => {
    holder.fetch.mockResolvedValue(new Response('nope', { status: 500 }));
    const { id } = await create();
    const res = await call(`/${id}/test`, { key: WRITE_KEY, method: 'POST' });
    expect(res.status).toBe(200);
    expect(WebhookDeliverySchema.parse(await data(res))).toMatchObject({
      error: 'HTTP 500',
      responseStatus: 500,
      status: 'failed',
    });
  });

  it('answers 404 when redelivering a delivery of another endpoint', async () => {
    holder.fetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const first = await create();
    const second = await create();
    const delivery = await data(
      await call(`/${first.id}/test`, { key: WRITE_KEY, method: 'POST' }),
    );
    const res = await call(`/${second.id}/deliveries/${delivery.id}/redeliver`, {
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(holder.triggerDeliver).not.toHaveBeenCalled();
  });
});
