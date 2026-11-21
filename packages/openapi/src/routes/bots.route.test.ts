// @vitest-environment node
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End to end over `/api/v1/bots`: the real `userAuthMiddleware` +
 * `workspaceAuthMiddleware` against `api_keys` rows on PGlite, the real scope
 * gates, controller, `BotRestService`, the `agentBotProvider` / `botMessage`
 * tRPC procedures, the model and the KeyVaults gatekeeper. Only the outside
 * world is stubbed: the gateway that holds platform connections, the runtime
 * cache, and the outbound HTTP request to the webhook callback URL.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  fetch: vi.fn(),
  serverDB: undefined as unknown,
  startClient: vi.fn(async () => 'started' as const),
  stopClient: vi.fn(async () => {}),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => holder.serverDB }));
vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    useMessageGateway = false;
    startClient = holder.startClient;
    stopClient = holder.stopClient;
  },
}));
vi.mock('@/server/services/bot/BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ invalidateBot: async () => {} }),
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  isSSRFBlockedError: () => false,
  ssrfSafeFetch: holder.fetch,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agentBotProviders, agents, apiKeys, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { verifyInboundSignature } =
  await import('@/server/services/bot/platforms/webhook/signature');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { DeletedResourceSchema } = await import('../types/common.type');
const { BotConnectionTestSchema, BotListResponseSchema, BotMessageSentSchema, BotSchema } =
  await import('../types/bot.type');
const BotRoutes = (await import('./bots.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/bots', BotRoutes);
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);

const OWNER = 'bot-route-owner';
const STRANGER = 'bot-route-stranger';
const WORKSPACE = 'bot-route-ws';
const AGENT = 'bot-route-agent';
const STRANGER_AGENT = 'bot-route-stranger-agent';
const WORKSPACE_AGENT = 'bot-route-ws-agent';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const WRITE_KEY = 'sk-lh-botwriteowner001';
const READ_KEY = 'sk-lh-botreadowner0001';
const OTHER_SCOPE_KEY = 'sk-lh-botchatowner0001';
const STRANGER_KEY = 'sk-lh-botstranger00001';
const WORKSPACE_KEY = 'sk-lh-botworkspace0001';

const SECRET = 'whsec_route_test_secret_0123456789abcdef';
const CALLBACK = 'https://example.com/lobehub/callback';

const call = (
  path: string,
  init: { body?: unknown; headers?: Record<string, string>; key?: string; method?: string } = {},
) =>
  app.request(`/api/v1/bots${path}`, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      'content-type': 'application/json',
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...init.headers,
    },
    method: init.method ?? 'GET',
  });

const data = async (res: Response) => ((await res.json()) as { data: any }).data;

const webhookBot = (overrides: Record<string, unknown> = {}) => ({
  agentId: AGENT,
  applicationId: 'route-test-bot',
  credentials: { callbackUrl: CALLBACK, signingSecret: SECRET },
  platform: 'webhook',
  ...overrides,
});

const create = async (
  body: Record<string, unknown> = webhookBot(),
  key = WRITE_KEY,
  headers?: Record<string, string>,
) => {
  const res = await call('', { body, headers, key, method: 'POST' });
  expect(res.status).toBe(201);
  return BotSchema.parse(await data(res));
};

const okResponse = () => new Response('ok', { status: 200 });

beforeEach(async () => {
  holder.fetch.mockReset();
  holder.startClient.mockClear();
  holder.stopClient.mockClear();

  await serverDB.delete(agentBotProviders);
  await serverDB.delete(apiKeys);
  await serverDB.delete(agents);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'WS', primaryOwnerId: OWNER, slug: 'bot-route-ws' });
  await serverDB
    .insert(workspaceMembers)
    .values({ role: 'owner', userId: OWNER, workspaceId: WORKSPACE });
  await serverDB.insert(agents).values([
    { id: AGENT, userId: OWNER },
    { id: STRANGER_AGENT, userId: STRANGER },
    { id: WORKSPACE_AGENT, userId: OWNER, workspaceId: WORKSPACE },
  ]);

  const key = (k: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: k,
    keyHash: hashApiKey(k),
    name: k,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(WRITE_KEY, OWNER, ['bot:read', 'bot:write']),
      key(READ_KEY, OWNER, ['bot:read']),
      key(OTHER_SCOPE_KEY, OWNER, ['chat:read', 'chat:write']),
      key(STRANGER_KEY, STRANGER, ['bot:read', 'bot:write']),
      key(WORKSPACE_KEY, OWNER, ['bot:read', 'bot:write'], WORKSPACE),
    ]);
});

const OPERATIONS = [
  { method: 'GET', path: '' },
  { body: webhookBot(), method: 'POST', path: '' },
  { method: 'GET', path: '/x' },
  { body: { settings: {} }, method: 'PATCH', path: '/x' },
  { method: 'DELETE', path: '/x' },
  { method: 'POST', path: '/x/enable' },
  { method: 'POST', path: '/x/disable' },
  { method: 'POST', path: '/x/test' },
  { body: { channelId: 'c', content: 'hi' }, method: 'POST', path: '/x/messages' },
];

describe('bot routes: authentication and scopes', () => {
  it('answers 401 without an API key on every operation', async () => {
    for (const op of OPERATIONS) {
      const res = await call(op.path, { body: op.body, method: op.method });
      expect(res.status, `${op.method} ${op.path}`).toBe(401);
    }
  });

  it('answers 403 insufficient_scope to a key without bot scopes on every operation', async () => {
    for (const op of OPERATIONS) {
      const res = await call(op.path, { body: op.body, key: OTHER_SCOPE_KEY, method: op.method });
      expect(res.status, `${op.method} ${op.path}`).toBe(403);
      expect(((await res.json()) as any).code).toBe('insufficient_scope');
    }
  });

  it('lets a bot:read key read but not write', async () => {
    const bot = await create();
    expect((await call('', { key: READ_KEY })).status).toBe(200);
    expect((await call(`/${bot.id}`, { key: READ_KEY })).status).toBe(200);
    for (const op of OPERATIONS.filter((op) => op.method !== 'GET')) {
      const res = await call(op.path.replace('/x', `/${bot.id}`), {
        body: op.body,
        key: READ_KEY,
        method: op.method,
      });
      expect(res.status, `${op.method} ${op.path}`).toBe(403);
    }
  });
});

describe('bot routes: isolation', () => {
  it("answers 404 for another user's bot on every addressed operation", async () => {
    const bot = await create();
    for (const op of OPERATIONS.filter((op) => op.path.startsWith('/x'))) {
      const res = await call(op.path.replace('/x', `/${bot.id}`), {
        body: op.body,
        key: STRANGER_KEY,
        method: op.method,
      });
      expect(res.status, `${op.method} ${op.path}`).toBe(404);
    }
    const list = BotListResponseSchema.parse(await data(await call('', { key: STRANGER_KEY })));
    expect(list.items).toEqual([]);
  });

  it("refuses to wire a bot to another user's agent", async () => {
    const res = await call('', {
      body: webhookBot({ agentId: STRANGER_AGENT }),
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('keeps personal and workspace bots apart, both ways', async () => {
    const ws = { 'X-Workspace-Id': WORKSPACE };
    const personal = await create();
    const workspace = await create(
      webhookBot({ agentId: WORKSPACE_AGENT, applicationId: 'route-test-ws-bot' }),
      WORKSPACE_KEY,
      ws,
    );
    expect(personal.workspaceId).toBeNull();
    expect(workspace.workspaceId).toBe(WORKSPACE);

    const personalList = BotListResponseSchema.parse(
      await data(await call('', { key: WRITE_KEY })),
    );
    expect(personalList.items.map((b) => b.id)).toEqual([personal.id]);
    const wsList = BotListResponseSchema.parse(
      await data(await call('', { headers: ws, key: WORKSPACE_KEY })),
    );
    expect(wsList.items.map((b) => b.id)).toEqual([workspace.id]);

    expect((await call(`/${workspace.id}`, { key: WRITE_KEY })).status).toBe(404);
    expect((await call(`/${personal.id}`, { headers: ws, key: WORKSPACE_KEY })).status).toBe(404);
    expect(
      (await call(`/${personal.id}`, { headers: ws, key: WORKSPACE_KEY, method: 'DELETE' })).status,
    ).toBe(404);

    // A personal-space agent cannot be wired from the workspace either.
    const res = await call('', {
      body: webhookBot({ applicationId: 'route-test-cross' }),
      headers: ws,
      key: WORKSPACE_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('refuses a personal key that names a workspace', async () => {
    const res = await call('', { headers: { 'X-Workspace-Id': WORKSPACE }, key: WRITE_KEY });
    expect(res.status).toBe(403);
  });
});

describe('bot routes: validation', () => {
  it('rejects malformed create bodies with 400', async () => {
    const bodies = [
      {},
      webhookBot({ agentId: undefined }),
      webhookBot({ credentials: 'nope' }),
      { ...webhookBot(), unknownField: true },
    ];
    for (const body of bodies) {
      const res = await call('', { body, key: WRITE_KEY, method: 'POST' });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('rejects credentials that break the platform schema with 400', async () => {
    const short = await call('', {
      body: webhookBot({ credentials: { callbackUrl: CALLBACK, signingSecret: 'short' } }),
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(short.status).toBe(400);
    const badId = await call('', {
      body: webhookBot({ applicationId: 'a b' }),
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(badId.status).toBe(400);
  });

  it('answers 409 when the application id is already bound', async () => {
    await create();
    const res = await call('', { body: webhookBot(), key: WRITE_KEY, method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('rejects an empty update and an empty message with 400', async () => {
    const bot = await create();
    expect((await call(`/${bot.id}`, { body: {}, key: WRITE_KEY, method: 'PATCH' })).status).toBe(
      400,
    );
    expect(
      (
        await call(`/${bot.id}/messages`, {
          body: { channelId: 'c', content: '' },
          key: WRITE_KEY,
          method: 'POST',
        })
      ).status,
    ).toBe(400);
    expect((await call('?limit=0', { key: WRITE_KEY })).status, 'limit below the minimum').toBe(
      400,
    );
  });
});

describe('bot routes: happy paths', () => {
  it('creates, reads, lists, updates, disables, enables and deletes a webhook bot', async () => {
    const bot = await create();
    expect(bot).toMatchObject({
      agentId: AGENT,
      applicationId: 'route-test-bot',
      enabled: true,
      platform: 'webhook',
      workspaceId: null,
    });
    // The callback URL is configuration; the signing secret never comes back.
    expect(bot.credentials.callbackUrl).toBe(CALLBACK);
    expect(bot.credentials.signingSecret).not.toBe(SECRET);
    expect(holder.startClient).toHaveBeenCalledWith('webhook', 'route-test-bot', OWNER);

    const got = BotSchema.parse(await data(await call(`/${bot.id}`, { key: READ_KEY })));
    expect(got.id).toBe(bot.id);

    const list = BotListResponseSchema.parse(
      await data(await call('?platform=webhook&limit=1', { key: READ_KEY })),
    );
    expect(list).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });

    // Round-tripping the masked secret keeps the stored one.
    const updated = BotSchema.parse(
      await data(
        await call(`/${bot.id}`, {
          body: {
            credentials: { ...bot.credentials, callbackUrl: 'https://example.com/v2' },
            settings: { charLimit: 500 },
          },
          key: WRITE_KEY,
          method: 'PATCH',
        }),
      ),
    );
    expect(updated.credentials.callbackUrl).toBe('https://example.com/v2');
    expect(updated.settings.charLimit).toBe(500);
    const [row] = await serverDB.select().from(agentBotProviders);
    expect(row.credentials).not.toContain(SECRET); // stored encrypted

    const disabled = BotSchema.parse(
      await data(await call(`/${bot.id}/disable`, { key: WRITE_KEY, method: 'POST' })),
    );
    expect(disabled.enabled).toBe(false);
    expect(holder.stopClient).toHaveBeenCalled();

    // A disabled bot neither tests nor speaks.
    expect((await call(`/${bot.id}/test`, { key: WRITE_KEY, method: 'POST' })).status).toBe(409);

    holder.startClient.mockClear();
    const enabled = BotSchema.parse(
      await data(await call(`/${bot.id}/enable`, { key: WRITE_KEY, method: 'POST' })),
    );
    expect(enabled.enabled).toBe(true);
    expect(holder.startClient).toHaveBeenCalledWith('webhook', 'route-test-bot', OWNER);

    const deleted = await call(`/${bot.id}`, { key: WRITE_KEY, method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(DeletedResourceSchema.parse(await data(deleted))).toEqual({ deleted: true, id: bot.id });
    expect((await call(`/${bot.id}`, { key: READ_KEY })).status).toBe(404);
  });

  it('tests the connection with a signed bot.ping and reports a refusal as valid:false', async () => {
    const bot = await create();

    holder.fetch.mockResolvedValueOnce(okResponse());
    const ok = BotConnectionTestSchema.parse(
      await data(await call(`/${bot.id}/test`, { key: WRITE_KEY, method: 'POST' })),
    );
    expect(ok).toEqual({ errors: [], valid: true });

    const [url, init] = holder.fetch.mock.calls[0];
    expect(url).toBe(CALLBACK);
    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({ botId: 'route-test-bot', type: 'bot.ping' });
    expect(
      verifyInboundSignature({
        body,
        secret: SECRET,
        signature: init.headers['X-LobeHub-Signature'],
        timestamp: init.headers['X-LobeHub-Timestamp'],
      }),
    ).toEqual({ ok: true });

    holder.fetch.mockResolvedValue(new Response('nope', { status: 401 }));
    const refused = await call(`/${bot.id}/test`, { key: WRITE_KEY, method: 'POST' });
    expect(refused.status).toBe(200);
    const result = BotConnectionTestSchema.parse(await data(refused));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ field: 'callbackUrl' });
  });

  it('sends a message as the bot: a signed bot.message.created to the callback URL', async () => {
    const bot = await create();
    holder.fetch.mockResolvedValueOnce(okResponse());

    const res = await call(`/${bot.id}/messages`, {
      body: { channelId: 'conv-42', content: 'Your order has shipped.', replyTo: 'msg-7' },
      key: WRITE_KEY,
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const sent = BotMessageSentSchema.parse(await data(res));
    expect(sent).toMatchObject({ channelId: 'conv-42', platform: 'webhook' });
    expect(sent.messageId).toMatch(/^out_/);

    const [url, init] = holder.fetch.mock.calls[0];
    expect(url).toBe(CALLBACK);
    expect(JSON.parse(init.body)).toMatchObject({
      botId: 'route-test-bot',
      data: {
        conversationId: 'conv-42',
        isDirect: false,
        messageId: sent.messageId,
        replyTo: 'msg-7',
        text: 'Your order has shipped.',
        threadId: null,
      },
      type: 'bot.message.created',
    });
    expect(init.headers['X-LobeHub-Event-Type']).toBe('bot.message.created');
  });
});
