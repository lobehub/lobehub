// @vitest-environment node
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import {
  agents,
  topics,
  userConnectors,
  users,
  workspaceAuditLogs,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getInboundWebhookKind } from '@/server/services/inboundWebhook/kinds';

interface RouterTestContext {
  clientIp?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
  workspaceRole?: string;
}

const { checkClaims, gateKeeper, maintain, teardown } = vi.hoisted(() => ({
  checkClaims: new Map<string, number>(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
  maintain:
    vi.fn<(ctx: { model: InboundWebhookModel; row: InboundWebhookView }) => Promise<void>>(),
  teardown:
    vi.fn<(ctx: { model: InboundWebhookModel; row: InboundWebhookView }) => Promise<void>>(),
}));

// Exercise the real router and DB while replacing platform authentication with a bounded test context.
vi.mock('@/libs/trpc/lambda', async () => {
  const { initTRPC } = await import('@trpc/server');
  const trpc = initTRPC.context<RouterTestContext>().create();
  return { router: trpc.router, authedProcedure: trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async ({ next }: { next: () => Promise<unknown> }) => next(),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  const { TRPCError } = await import('@trpc/server');
  return {
    wsCompatProcedure: authedProcedure,
    requireWorkspaceRoleWhenScoped:
      () =>
      async ({ ctx, next }: { ctx: RouterTestContext; next: () => Promise<unknown> }) => {
        if (ctx.workspaceId && ctx.workspaceRole === 'viewer')
          throw new TRPCError({ code: 'FORBIDDEN' });
        return next();
      },
  };
});
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => gateKeeper },
}));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({ scheduleInboundWebhookSweep: vi.fn() }));
vi.mock('@/server/services/inboundWebhook/kinds', () => ({
  getInboundWebhookKind: vi.fn(() => ({
    maintain,
    teardown,
    buildPrompt: () => '',
    handleDelivery: async () => ({}),
  })),
}));
vi.mock('@/server/services/inboundWebhook/kinds/mcpEvents/subscription', () => ({
  maintenanceBackoff: (n: number) => 60_000 * 2 ** n,
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    inboundWebhook: {
      claimCheck: async (id: string) => {
        const now = Date.now();
        const previous = checkClaims.get(id);
        if (previous !== undefined && now - previous < 30_000) return false;
        checkClaims.set(id, now);
        return true;
      },
    },
  },
}));

const { inboundWebhookRouter } = await import('./inboundWebhook');
const db = await getTestDB();
const creator = 'router-webhook-creator';
const colleague = 'router-webhook-colleague';
const workspaceId = 'router-webhook-workspace';
const otherWorkspaceId = 'router-webhook-other';
const missingId = '00000000-0000-0000-0000-000000000000';
const caller = (userId = creator, scope?: { workspaceId?: string; workspaceRole?: string }) =>
  inboundWebhookRouter.createCaller({
    serverDB: db,
    userId,
    clientIp: '127.0.0.1',
    ...scope,
  } as unknown as Parameters<typeof inboundWebhookRouter.createCaller>[0]);
const scoped = (role = 'member', userId = creator) =>
  caller(userId, { workspaceId, workspaceRole: role });

const seed = async (
  options: {
    userId?: string;
    workspaceId?: string;
    status?: 'pending' | 'active' | 'deleting' | 'error' | 'terminated';
    createdAt?: Date;
  } = {},
) => {
  const userId = options.userId ?? creator;
  const scope = options.workspaceId;
  const agentId = `${scope ?? 'personal'}-${userId}-agent`;
  const topicId = `${agentId}-topic`;
  await db
    .insert(agents)
    .values({
      id: agentId,
      userId,
      workspaceId: scope,
      avatar: '🤖',
      backgroundColor: '#123456',
      title: 'Test Agent',
    })
    .onConflictDoNothing();
  await db
    .insert(topics)
    .values({ id: topicId, agentId, userId, workspaceId: scope, title: 'Event topic' })
    .onConflictDoNothing();
  const [connector] = await db
    .insert(userConnectors)
    .values({
      userId,
      workspaceId: scope,
      identifier: 'linear',
      name: 'Linear',
      sourceType: 'custom',
      status: 'connected',
      metadata: { avatar: 'https://example.com/linear.png' },
    })
    .returning();
  return new InboundWebhookModel(db, userId, scope, gateKeeper).create({
    agentId,
    topicId,
    connectorId: connector.id,
    kind: 'mcp_events',
    config: { arguments: { team: 'ENG' }, eventName: 'issue.created' },
    secret: 'whsec_router_secret',
    state: { refreshBefore: null },
    verification: { scheme: 'standard_webhooks' },
    name: 'Issue events',
    status: options.status ?? 'active',
    createdAt: options.createdAt,
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  checkClaims.clear();
  maintain.mockReset().mockImplementation(async ({ model, row }) => {
    await model.update(row.id, { status: 'active', lastError: null });
  });
  teardown.mockReset().mockResolvedValue(undefined);
  vi.mocked(getInboundWebhookKind).mockReturnValue({
    maintain,
    teardown,
    buildPrompt: () => '',
    handleDelivery: async () => ({}),
  });
  await db.delete(users);
  await db.insert(users).values([{ id: creator }, { id: colleague }]);
  await db.insert(workspaces).values([
    { id: workspaceId, slug: workspaceId, name: 'Team', primaryOwnerId: creator },
    { id: otherWorkspaceId, slug: otherWorkspaceId, name: 'Other team', primaryOwnerId: creator },
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(workspaces);
  await db.delete(users);
});

describe('inboundWebhook tRPC resource contract', () => {
  it('lists only the caller personal rows and excludes internal lifecycle states and secrets', async () => {
    const row = await seed();
    await seed({ userId: colleague });
    await seed({ workspaceId });
    await seed({ status: 'pending' });
    await seed({ status: 'deleting' });
    const listed = await caller().list();
    expect(listed.map((item) => item.id)).toEqual([row.id]);
    expect(listed[0]).toMatchObject({
      canManage: true,
      canCheck: true,
      expiresAt: null,
      agent: { title: 'Test Agent' },
      topic: { title: 'Event topic' },
      connector: {
        agentId: null,
        identifier: 'linear',
        name: 'Linear',
        avatar: 'https://example.com/linear.png',
      },
      source: { arguments: { team: 'ENG' }, eventName: 'issue.created', kind: 'mcp_events' },
    });
    expect(listed[0]).not.toHaveProperty('secret');
    expect(listed[0]).not.toHaveProperty('state');
    expect(JSON.stringify(listed)).not.toContain('whsec_router_secret');
  });

  // The default agent is stored without a title or avatar; the list must show it
  // the way the sidebar does, while an agent the user left unnamed stays unnamed.
  it.each([
    [
      'the default agent',
      INBOX_SESSION_ID,
      null,
      { avatar: DEFAULT_INBOX_AVATAR, title: DEFAULT_INBOX_TITLE },
    ],
    [
      'a renamed default agent',
      INBOX_SESSION_ID,
      'My helper',
      { avatar: DEFAULT_INBOX_AVATAR, title: 'My helper' },
    ],
    ['an unnamed agent of the user', null, null, { avatar: null, title: null }],
  ] as const)('shows %s by its resolved name and avatar', async (_, slug, title, expected) => {
    const agentId = `identity-${slug ?? 'custom'}-${title ?? 'untitled'}`;
    await db.insert(agents).values({ id: agentId, slug, title, userId: creator });
    await new InboundWebhookModel(db, creator, undefined, gateKeeper).create({
      agentId,
      config: { arguments: {}, eventName: 'issue.created' },
      kind: 'mcp_events',
      secret: 'whsec_identity',
      state: { refreshBefore: null },
      status: 'active',
      verification: { scheme: 'standard_webhooks' },
    });

    const [item] = await caller().list();

    expect(item.agent).toEqual({ backgroundColor: null, id: agentId, ...expected });
  });

  it('lists all workspace creators newest first and excludes other scopes', async () => {
    const older = await seed({ workspaceId, createdAt: new Date('2026-01-01') });
    const newer = await seed({ workspaceId, userId: colleague, createdAt: new Date('2026-01-02') });
    await seed();
    await seed({ workspaceId: otherWorkspaceId });
    expect((await scoped().list()).map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it.each([
    ['member', creator, true],
    ['member', colleague, false],
    ['admin', colleague, true],
    ['owner', colleague, true],
  ] as const)('reports canManage for %s (%s) as %s', async (role, userId, canManage) => {
    const row = await seed({ workspaceId });
    const [item] = await scoped(role, userId).list();
    expect(item.id).toBe(row.id);
    expect(item.canManage).toBe(canManage);
  });

  it('checks through kind maintenance and returns the fresh public row', async () => {
    const row = await seed({ status: 'error' });
    const result = await caller().check({ id: row.id });
    expect(result).toMatchObject({
      id: row.id,
      status: 'active',
      lastError: null,
      canManage: true,
    });
    expect(result).not.toHaveProperty('secret');
    expect(maintain).toHaveBeenCalledTimes(1);
  });

  it('returns discovered delivery errors as rows instead of throwing', async () => {
    const row = await seed();
    maintain.mockImplementation(async ({ model, row: current }) => {
      await model.update(current.id, { status: 'error', lastError: 'auth' });
    });
    await expect(caller().check({ id: row.id })).resolves.toMatchObject({
      id: row.id,
      status: 'error',
      lastError: 'auth',
    });
  });

  it('limits checking the same row to once per 30 seconds', async () => {
    const row = await seed();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await caller().check({ id: row.id });
    await expect(caller().check({ id: row.id })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(maintain).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 30_001);
    await expect(caller().check({ id: row.id })).resolves.toMatchObject({ id: row.id });
    expect(maintain).toHaveBeenCalledTimes(2);
  });

  it.each(['owner', 'admin'])(
    'allows workspace %s to check another creator endpoint',
    async (role) => {
      const row = await seed({ workspaceId });
      await expect(scoped(role, colleague).check({ id: row.id })).resolves.toMatchObject({
        id: row.id,
      });
      const context = maintain.mock.calls[0][0];
      expect(await context.model.getSecret(row.id)).toBe('whsec_router_secret');
    },
  );

  it('forbids members from checking or deleting another creator endpoint', async () => {
    const row = await seed({ workspaceId });
    await expect(scoped('member', colleague).check({ id: row.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(scoped('member', colleague).delete({ id: row.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(maintain).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    expect(checkClaims.size).toBe(0);
  });

  it('rejects viewers at the write-role boundary', async () => {
    const row = await seed({ workspaceId });
    await expect(scoped('viewer').check({ id: row.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(scoped('viewer').delete({ id: row.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('reports unsupported checks before consuming the cooldown', async () => {
    const row = await seed();
    vi.mocked(getInboundWebhookKind).mockReturnValueOnce(undefined);
    await expect(caller().check({ id: row.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(checkClaims.size).toBe(0);
  });

  it('reports missing, hidden and cross-scope check targets as not found', async () => {
    const pending = await seed({ status: 'pending' });
    const deleting = await seed({ status: 'deleting' });
    const foreign = await seed({ userId: colleague });
    for (const id of [missingId, pending.id, deleting.id, foreign.id]) {
      await expect(caller().check({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(maintain).not.toHaveBeenCalled();
  });

  it('does not return success if deletion wins while a check was in flight', async () => {
    const row = await seed();
    maintain.mockImplementation(async ({ model, row: current }) => {
      await model.update(current.id, { status: 'deleting' });
    });
    await expect(caller().check({ id: row.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes through remote teardown and writes workspace deletion audit metadata', async () => {
    const row = await seed({ workspaceId });
    teardown.mockImplementation(async ({ model, row: current }) => {
      expect((await model.findById(current.id))?.status).toBe('deleting');
    });
    await expect(scoped('admin', colleague).delete({ id: row.id })).resolves.toEqual({
      success: true,
    });
    expect(
      await new InboundWebhookModel(db, creator, workspaceId).findById(row.id),
    ).toBeUndefined();
    expect(teardown).toHaveBeenCalledTimes(1);
    const [audit] = await db.select().from(workspaceAuditLogs);
    expect(audit).toMatchObject({
      action: 'webhook.deleted',
      resourceId: row.id,
      resourceType: 'webhook',
      userId: colleague,
      workspaceId,
      metadata: { direction: 'inbound', kind: 'mcp_events' },
    });
  });

  it('keeps failed remote teardowns hidden and queued for retry', async () => {
    const row = await seed();
    teardown.mockRejectedValue(new Error('Remote offline'));
    await expect(caller().delete({ id: row.id })).resolves.toEqual({ success: true });
    const remaining = await new InboundWebhookModel(db, creator).findById(row.id);
    expect(remaining).toMatchObject({ status: 'deleting', maintenanceFailures: 1 });
    expect(remaining?.nextMaintenanceAt).toBeInstanceOf(Date);
    expect(await caller().list()).toEqual([]);
    expect(await db.select().from(workspaceAuditLogs)).toEqual([]);
  });

  it('does not delete targets outside the visible scope', async () => {
    const row = await seed({ userId: colleague });
    await expect(caller().delete({ id: row.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller().delete({ id: missingId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(teardown).not.toHaveBeenCalled();
    expect(
      await db.select().from(userConnectors).where(eq(userConnectors.id, row.connectorId!)),
    ).toHaveLength(1);
  });
});
