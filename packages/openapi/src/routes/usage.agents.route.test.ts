// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/v1/usage/agents/{agentId}` over real HTTP: the real usage routes
 * behind the auth + workspace middlewares, real API-key rows and the shared
 * `UsageRecordService` aggregation, on PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, messages, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { AgentUsageStatsSchema } = await import('../types/usage.type');
const UsageRoutes = (await import('./usage.route')).default;

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
app.route('/usage', UsageRoutes);

const OWNER = 'r12-usage-owner';
const STRANGER = 'r12-usage-stranger';
const WORKSPACE = 'r12-usage-ws';

const KEYS = {
  chatOnly: 'sk-lh-r12usagechat0001',
  owner: 'sk-lh-r12usageowner001',
  stranger: 'sk-lh-r12usagestrange1',
  workspace: 'sk-lh-r12usagewspace01',
} as const;

const RANGE = 'startAt=2026-11-01&endAt=2026-11-30';

const call = (path: string, init: { key?: string; workspaceId?: string } = {}) =>
  app.request(`/api/v1/usage${path}`, {
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
    },
  });

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  await serverDB.delete(messages);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R12 usage', primaryOwnerId: OWNER, slug: 'r12-usage' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
  await serverDB.insert(agents).values([
    { id: 'agt-own', userId: OWNER },
    { id: 'agt-stranger', userId: STRANGER },
    { id: 'agt-ws', userId: OWNER, workspaceId: WORKSPACE },
  ]);

  const usage = (cost: number, totalTokens: number) => ({
    cost,
    totalInputTokens: totalTokens - 10,
    totalOutputTokens: 10,
    totalTokens,
  });
  await serverDB.insert(messages).values([
    {
      agentId: 'agt-own',
      content: 'a',
      createdAt: new Date('2026-11-02T10:00:00Z'),
      id: 'msg-1',
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      usage: usage(0.5, 110),
      userId: OWNER,
    },
    {
      agentId: 'agt-own',
      content: 'b',
      createdAt: new Date('2026-11-03T10:00:00Z'),
      id: 'msg-2',
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      usage: usage(0.25, 60),
      userId: OWNER,
    },
    // outside the range
    {
      agentId: 'agt-own',
      content: 'c',
      createdAt: new Date('2026-10-02T10:00:00Z'),
      id: 'msg-3',
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      usage: usage(9, 900),
      userId: OWNER,
    },
  ]);

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
      key(KEYS.owner, OWNER, ['usage:read']),
      key(KEYS.chatOnly, OWNER, ['chat:read']),
      key(KEYS.stranger, STRANGER, ['usage:read']),
      key(KEYS.workspace, OWNER, ['usage:read'], WORKSPACE),
    ]);
});

describe('GET /usage/agents/:agentId', () => {
  it('answers 401 without credentials and 403 without usage:read', async () => {
    expect((await call(`/agents/agt-own?${RANGE}`)).status).toBe(401);

    const res = await call(`/agents/agt-own?${RANGE}`, { key: KEYS.chatOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it("aggregates the agent's replies inside the range", async () => {
    const res = await call(`/agents/agt-own?${RANGE}`, { key: KEYS.owner });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(AgentUsageStatsSchema.parse(data)).toEqual(data);
    expect(data.summary.totalRequests).toBe(2);
    expect(data.summary.totalCost).toBeCloseTo(0.75);
    // one bucket per day of the range, zero-filled
    expect(data.buckets).toHaveLength(30);
    expect(data.buckets.filter((bucket: any) => bucket.totalCost > 0)).toHaveLength(2);
    expect(data.byModel).toMatchObject([{ model: 'gpt-5', provider: 'openai', requests: 2 }]);
  });

  it('buckets by week', async () => {
    const { data } = await json(
      await call(`/agents/agt-own?${RANGE}&granularity=week`, { key: KEYS.owner }),
    );

    expect(data.buckets.length).toBeLessThan(30);
    expect(data.buckets.filter((bucket: any) => bucket.totalCost > 0)).toHaveLength(1);
  });

  it("answers 404 for another user's agent and a workspace agent outside its workspace", async () => {
    expect((await call(`/agents/agt-stranger?${RANGE}`, { key: KEYS.owner })).status).toBe(404);
    expect((await call(`/agents/agt-own?${RANGE}`, { key: KEYS.stranger })).status).toBe(404);
    // a workspace agent is not reachable from the personal scope …
    expect((await call(`/agents/agt-ws?${RANGE}`, { key: KEYS.owner })).status).toBe(404);
    // … and a personal agent is not reachable from the workspace
    expect(
      (await call(`/agents/agt-own?${RANGE}`, { key: KEYS.workspace, workspaceId: WORKSPACE }))
        .status,
    ).toBe(404);

    const ws = await call(`/agents/agt-ws?${RANGE}`, {
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });
    expect(ws.status).toBe(200);
    expect((await json(ws)).data.summary.totalRequests).toBe(0);
  });

  it('validates the range', async () => {
    for (const query of [
      '',
      'startAt=2026-11-01',
      'startAt=nope&endAt=2026-11-30',
      'startAt=2026-12-01&endAt=2026-11-01',
      `${RANGE}&granularity=month`,
    ]) {
      const res = await call(`/agents/agt-own?${query}`, { key: KEYS.owner });
      expect(res.status, query).toBe(400);
    }
  });
});
