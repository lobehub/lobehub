// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/share-links` over real HTTP: the real routes behind the same auth +
 * workspace middlewares `app.ts` mounts, the real scope gates and the shared
 * `topic` / `agentShare` share procedures, on a PGlite database with real
 * `api_keys` rows.
 *
 * Two switches are faked: the business build flag (so one file covers both
 * the self-hosted `501` answers and the cloud agent-share path) and the
 * per-user agent-share rollout flag. Everything else runs as in production.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ business: false, serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@lobechat/business-const', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    get ENABLE_BUSINESS_FEATURES() {
      return holder.business;
    },
  };
});

vi.mock('@/server/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getServerFeatureFlagsStateFromRuntimeConfig: async () => ({ enableAgentShare: true }),
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agentShares, agents, apiKeys, topicShares, topics, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const ShareLinkRoutes = (await import('./share-links.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/share-links', ShareLinkRoutes);

const OWNER = 'r9-share-owner';
const STRANGER = 'r9-share-stranger';
const WORKSPACE = 'r9-share-ws';
const TOPIC = 'tpc_r9share';
const WS_TOPIC = 'tpc_r9sharews';
const AGENT = 'agt_r9share';

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  chatOnly: 'sk-lh-r9sharechatonly1',
  ownerRead: 'sk-lh-r9shareownerread',
  ownerWrite: 'sk-lh-r9shareownerwrit',
  stranger: 'sk-lh-r9sharestranger1',
  strangerWs: 'sk-lh-r9sharestrangws1',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const enable = (resourceType: string, resourceId: string, key: string = KEYS.ownerWrite) =>
  call('/share-links', { body: { resourceId, resourceType }, key, method: 'POST' });

beforeEach(async () => {
  holder.business = false;
  await serverDB.delete(topicShares);
  await serverDB.delete(agentShares);
  await serverDB.delete(topics);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'R9 share', primaryOwnerId: OWNER, slug: 'r9-share' });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: STRANGER, workspaceId: WORKSPACE },
  ]);
  await serverDB.insert(topics).values([
    { id: TOPIC, title: 'Personal topic', userId: OWNER },
    { id: WS_TOPIC, title: 'Workspace topic', userId: OWNER, workspaceId: WORKSPACE },
  ]);
  await serverDB.insert(agents).values({ id: AGENT, title: 'Shared agent', userId: OWNER });

  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.ownerWrite, OWNER, ['share:write']),
      key(KEYS.ownerRead, OWNER, ['share:read']),
      key(KEYS.chatOnly, OWNER, ['chat:write']),
      key(KEYS.stranger, STRANGER, ['share:write']),
      key(KEYS.strangerWs, STRANGER, ['share:write'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await call(`/share-links/topic/${TOPIC}`);

    expect(res.status).toBe(401);
  });

  it('does not let a chat:write key publish — sharing is its own scope', async () => {
    const res = await enable('topic', TOPIC, KEYS.chatOnly);

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets a share:read key read but not enable', async () => {
    expect((await call(`/share-links/topic/${TOPIC}`, { key: KEYS.ownerRead })).status).toBe(200);

    const res = await enable('topic', TOPIC, KEYS.ownerRead);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });
});

describe('request validation', () => {
  it.each([
    ['an unknown resource type', { resourceId: TOPIC, resourceType: 'file' }],
    ['a missing resource id', { resourceType: 'topic' }],
    ['an artifact without its message', { resourceType: 'artifact', topicId: TOPIC }],
  ])('rejects %s', async (_label, body) => {
    const res = await call('/share-links', { body, key: KEYS.ownerWrite, method: 'POST' });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it('rejects an unknown resource type in the path', async () => {
    const res = await call(`/share-links/message/${TOPIC}`, { key: KEYS.ownerRead });

    expect(res.status).toBe(400);
  });
});

describe('topic share links', () => {
  it('enables, reads and disables a link', async () => {
    const before = await json(await call(`/share-links/topic/${TOPIC}`, { key: KEYS.ownerRead }));
    expect(before.data).toEqual({
      enabled: false,
      resourceId: TOPIC,
      resourceType: 'topic',
      shareId: null,
      url: null,
      viewCount: null,
    });

    const enabled = await enable('topic', TOPIC);
    expect(enabled.status).toBe(200);
    const link = (await json(enabled)).data;
    expect(link).toMatchObject({ enabled: true, resourceId: TOPIC, resourceType: 'topic' });
    expect(link.shareId).toEqual(expect.any(String));
    expect(link.url).toMatch(new RegExp(`/share/t/${link.shareId}$`));

    // Enabling again is idempotent: same share, same URL.
    expect((await json(await enable('topic', TOPIC))).data).toEqual(link);

    const read = await json(await call(`/share-links/topic/${TOPIC}`, { key: KEYS.ownerRead }));
    expect(read.data).toEqual(link);

    const disabled = await call(`/share-links/topic/${TOPIC}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(disabled.status).toBe(200);
    expect((await json(disabled)).data).toMatchObject({ enabled: false, shareId: null });
  });

  it("answers 404 for another user's topic", async () => {
    const res = await enable('topic', TOPIC, KEYS.stranger);

    expect(res.status).toBe(404);
  });

  it("never reveals another user's link", async () => {
    await enable('topic', TOPIC);

    const res = await call(`/share-links/topic/${TOPIC}`, { key: KEYS.stranger });
    expect((await json(res)).data).toMatchObject({ enabled: false, shareId: null, url: null });
  });

  it('keeps workspace topics inside the workspace', async () => {
    // A personal key cannot reach the workspace topic …
    expect((await enable('topic', WS_TOPIC)).status).toBe(404);

    // … and a member of the workspace who is neither creator nor co-editor
    // of the conversation cannot publish it.
    const member = await enable('topic', WS_TOPIC, KEYS.strangerWs);
    expect([403, 404]).toContain(member.status);
  });
});

describe('cloud-only resource types', () => {
  it.each([
    ['agent', AGENT],
    ['page', 'docs_r9share'],
    ['artifact', 'dep_r9share'],
  ])('answers 501 feature_unavailable for a %s on a self-hosted build', async (type, id) => {
    const res = await call(`/share-links/${type}/${id}`, { key: KEYS.ownerRead });

    expect(res.status).toBe(501);
    expect((await json(res)).code).toBe('feature_unavailable');
  });

  it('answers 501 when publishing an artifact on a self-hosted build', async () => {
    const res = await call('/share-links', {
      body: {
        artifactIdentifier: 'landing',
        messageId: 'msg_r9share',
        resourceType: 'artifact',
        topicId: TOPIC,
      },
      key: KEYS.ownerWrite,
      method: 'POST',
    });

    expect(res.status).toBe(501);
    expect((await json(res)).code).toBe('feature_unavailable');
  });

  it('enables and pauses an agent link when business features are on', async () => {
    holder.business = true;

    const enabled = await enable('agent', AGENT);
    expect(enabled.status).toBe(200);
    const link = (await json(enabled)).data;
    expect(link).toMatchObject({ enabled: true, resourceType: 'agent', viewCount: 0 });
    expect(link.url).toMatch(/\/a\/[^/]+$/);

    const paused = await call(`/share-links/agent/${AGENT}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    // Pausing keeps the share id and URL for a later re-enable.
    expect((await json(paused)).data).toEqual({ ...link, enabled: false });

    expect((await json(await enable('agent', AGENT))).data).toEqual(link);

    // Someone else's agent is refused by the agent-share ownership guard.
    expect((await enable('agent', AGENT, KEYS.stranger)).status).toBe(403);
  });
});
