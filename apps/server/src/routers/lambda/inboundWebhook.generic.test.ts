// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { agents, signals, topics, users, workspaceAuditLogs, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type * as AppEnvModule from '@/envs/app';
import { receiveInboundWebhook } from '@/server/services/inboundWebhook/receiver';

interface RouterTestContext {
  clientIp?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
  workspaceRole?: string;
}

const boundary = vi.hoisted(() => ({
  canEdit: vi.fn(),
  enabled: vi.fn(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
}));
vi.mock('@/envs/app', async (importOriginal) => {
  const actual = await importOriginal<typeof AppEnvModule>();
  return { appEnv: { ...actual.appEnv, APP_URL: 'https://app.test' } };
});
vi.mock('@/server/services/inboundWebhook/featureGate', () => ({
  isWebhookEnabled: boundary.enabled,
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanEditResource: boundary.canEdit,
}));
vi.mock('@/libs/trpc/lambda', async () => {
  const { initTRPC } = await import('@trpc/server');
  const trpc = initTRPC.context<RouterTestContext>().create();
  return { authedProcedure: trpc.procedure, mergeRouters: trpc.mergeRouters, router: trpc.router };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async ({ next }: { next: () => Promise<unknown> }) => next(),
}));
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission:
    () =>
    ({ next }: { next: () => Promise<unknown> }) =>
      next(),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return {
    requireWorkspaceRoleWhenScoped:
      () =>
      ({ next }: { next: () => Promise<unknown> }) =>
        next(),
    wsCompatProcedure: authedProcedure,
  };
});
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gateKeeper },
}));
vi.mock('@/server/services/inboundWebhook/sweep', () => ({ scheduleInboundWebhookSweep: vi.fn() }));
vi.mock('@/server/services/inboundWebhook/scheduler', () => ({
  scheduleInboundWebhookWake: vi.fn(async () => {}),
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ afterUnscoped: () => {} }));
vi.mock('@/server/services/redis', () => ({
  redisService: { inboundWebhook: { countDelivery: async () => 1 } },
}));

const { inboundWebhookRouter } = await import('./inboundWebhook');
const db = await getTestDB();
const creator = 'generic-router-creator';
const colleague = 'generic-router-colleague';
const workspaceId = 'generic-router-workspace';
const agentId = 'generic-router-agent';

const caller = (userId = creator, scope: { workspaceId?: string; workspaceRole?: string } = {}) =>
  inboundWebhookRouter.createCaller({
    clientIp: '127.0.0.1',
    serverDB: db,
    userId,
    ...scope,
  } as unknown as Parameters<typeof inboundWebhookRouter.createCaller>[0]);
const inWorkspace = (userId: string, workspaceRole = 'member') =>
  caller(userId, { workspaceId, workspaceRole });
const tokenOf = (endpoint: string | null) => endpoint!.split('/').at(-1)!;

beforeEach(async () => {
  vi.clearAllMocks();
  boundary.enabled.mockResolvedValue(true);
  boundary.canEdit.mockResolvedValue(undefined);
  await db.delete(users);
  await db.insert(users).values([{ id: creator }, { id: colleague }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Team', primaryOwnerId: creator, slug: workspaceId });
  await db.insert(agents).values([
    { id: agentId, userId: creator },
    { id: `${agentId}-ws`, userId: creator, visibility: 'public', workspaceId },
  ]);
});
afterEach(async () => {
  await db.delete(users);
  vi.restoreAllMocks();
});

describe('generic webhook management', () => {
  it('creates an active webhook with a working call URL', async () => {
    const item = await caller().create({ agentId, instructions: '  Triage it  ', name: 'CI' });
    expect(item).toMatchObject({
      canCheck: false,
      canManage: true,
      instructions: 'Triage it',
      kind: 'generic',
      name: 'CI',
      source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
      status: 'active',
      topic: null,
    });
    expect(item.endpoint).toMatch(
      new RegExp(`^https://app\\.test/api/webhooks/inbound/${item.id}/[\\w-]{43}$`),
    );
    const delivered = await receiveInboundWebhook(db, {
      body: '{}',
      headers: new Headers(),
      id: item.id,
      pathToken: tokenOf(item.endpoint),
    });
    expect(delivered.status).toBe(202);
  });

  it('refuses to create while the feature is off, or for an agent the caller cannot edit', async () => {
    boundary.enabled.mockResolvedValueOnce(false);
    await expect(caller().create({ agentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    boundary.canEdit.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));
    await expect(inWorkspace(colleague).create({ agentId: `${agentId}-ws` })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    expect(boundary.canEdit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: `${agentId}-ws`, resourceType: 'agent', workspaceId }),
    );
  });

  it("shows the call URL only to the webhook's creator", async () => {
    const created = await inWorkspace(creator).create({ agentId: `${agentId}-ws` });
    const mine = await inWorkspace(creator).list({ agentId: `${agentId}-ws` });
    expect(mine.map((item) => item.endpoint)).toEqual([created.endpoint]);
    const theirs = await inWorkspace(colleague).list({ agentId: `${agentId}-ws` });
    expect(theirs).toMatchObject([
      { canConfigure: false, canManage: false, endpoint: null, id: created.id },
    ]);
    // Calls run as the creator, so an admin who manages the webhook still gets no URL to call.
    const admin = await inWorkspace(colleague, 'admin').list({ agentId: `${agentId}-ws` });
    expect(admin).toMatchObject([{ canConfigure: false, canManage: true, endpoint: null }]);
    expect(await inWorkspace(creator).list({ agentId: 'another-agent' })).toEqual([]);

    const actions = await db
      .select({ action: workspaceAuditLogs.action })
      .from(workspaceAuditLogs)
      .where(eq(workspaceAuditLogs.resourceId, created.id));
    expect(actions).toEqual([{ action: 'webhook.created' }]);
  });

  it("keeps a private agent's webhook task and URL from the other members", async () => {
    await db.insert(agents).values({
      id: `${agentId}-private`,
      userId: creator,
      visibility: 'private',
      workspaceId,
    });
    const created = await inWorkspace(creator).create({
      agentId: `${agentId}-private`,
      instructions: 'Read the payroll sheet',
    });
    const [seen] = await inWorkspace(colleague, 'admin').list();
    expect(seen).toMatchObject({ agent: null, endpoint: null, id: created.id, instructions: null });
    const [own] = await inWorkspace(creator).list();
    expect(own).toMatchObject({
      endpoint: created.endpoint,
      instructions: 'Read the payroll sheet',
    });
  });

  it("lets an admin pause a private agent's webhook, but not change, test or read it", async () => {
    await db.insert(agents).values({
      id: `${agentId}-private`,
      userId: creator,
      visibility: 'private',
      workspaceId,
    });
    const created = await inWorkspace(creator).create({ agentId: `${agentId}-private` });
    const admin = inWorkspace(colleague, 'admin');

    await expect(
      admin.update({ autoApprove: true, id: created.id, instructions: 'Export everything' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(admin.sendTest({ id: created.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(admin.rotateToken({ id: created.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(admin.listDeliveries({ id: created.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await admin.update({ id: created.id, paused: true })).status).toBe('paused');

    const [own] = await inWorkspace(creator).list();
    expect(own).toMatchObject({ instructions: null, source: { autoApprove: false } });
    expect(tokenOf(own.endpoint)).toBe(tokenOf(created.endpoint));
  });

  it("keeps what another member's webhook runs out of an admin's hands, even on a public agent", async () => {
    const created = await inWorkspace(creator).create({
      agentId: `${agentId}-ws`,
      instructions: 'Triage CI',
    });
    const admin = inWorkspace(colleague, 'admin');

    for (const attempt of [
      () => admin.update({ autoApprove: true, id: created.id, instructions: 'Export everything' }),
      () => admin.sendTest({ id: created.id }),
      () => admin.rotateToken({ id: created.id }),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect((await admin.update({ id: created.id, paused: true })).status).toBe('paused');
    const [own] = await inWorkspace(creator).list({ agentId: `${agentId}-ws` });
    expect(own).toMatchObject({
      canConfigure: true,
      endpoint: created.endpoint,
      instructions: 'Triage CI',
      source: { autoApprove: false },
    });
    await admin.delete({ id: created.id });
    expect(await inWorkspace(creator).list({ agentId: `${agentId}-ws` })).toEqual([]);
  });

  it('pauses, resumes and changes settings, leaving the URL as it was', async () => {
    const created = await caller().create({ agentId });
    const paused = await caller().update({ id: created.id, paused: true });
    expect(paused.status).toBe('paused');
    const changed = await caller().update({
      autoApprove: true,
      id: created.id,
      name: '',
      paused: false,
      topicMode: 'reuse',
    });
    expect(changed).toMatchObject({
      endpoint: created.endpoint,
      name: null,
      source: { autoApprove: true, kind: 'generic', topicMode: 'reuse' },
      status: 'active',
    });
  });

  it('rotates the token so the previous URL stops working at once', async () => {
    const created = await caller().create({ agentId });
    const rotated = await caller().rotateToken({ id: created.id });
    expect(rotated.endpoint).not.toBe(created.endpoint);
    const call = (endpoint: string | null) =>
      receiveInboundWebhook(db, {
        body: '{}',
        headers: new Headers(),
        id: created.id,
        pathToken: tokenOf(endpoint),
      });
    expect((await call(created.endpoint)).status).toBe(401);
    expect((await call(rotated.endpoint)).status).toBe(202);
  });

  it("lets only the webhook's managers change it", async () => {
    const created = await inWorkspace(creator).create({ agentId: `${agentId}-ws` });
    for (const run of [
      () => inWorkspace(colleague).update({ id: created.id, paused: true }),
      () => inWorkspace(colleague).rotateToken({ id: created.id }),
      () => inWorkspace(colleague).sendTest({ id: created.id }),
      () => inWorkspace(colleague).listDeliveries({ id: created.id }),
    ])
      await expect(run()).rejects.toBeInstanceOf(TRPCError);
    await expect(
      inWorkspace(colleague, 'admin').update({ id: created.id, paused: true }),
    ).resolves.toMatchObject({ status: 'paused' });
  });

  it('refuses to edit an MCP subscription as a generic webhook', async () => {
    await db.insert(topics).values({ agentId, id: 'generic-router-topic', userId: creator });
    const mcp = await new InboundWebhookModel(db, creator, undefined, boundary.gateKeeper).create({
      agentId,
      config: { arguments: {}, eventName: 'issue.created' },
      kind: 'mcp_events',
      secret: 'whsec_x',
      status: 'active',
      topicId: 'generic-router-topic',
      verification: { scheme: 'standard_webhooks' },
    });
    await expect(caller().update({ id: mcp.id, paused: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('sends a test through the real receiver and lists it as a delivery', async () => {
    const created = await caller().create({ agentId });
    expect(await caller().sendTest({ id: created.id })).toEqual({
      accepted: true,
      error: undefined,
      status: 202,
    });
    const page = await caller().listDeliveries({ id: created.id });
    expect(page.items).toMatchObject([
      { payloadPurged: false, status: 'pending', test: true, threadKey: null, topic: null },
    ]);
    expect(page.items[0].preview).toContain('test delivery');
    expect(await db.select().from(signals).where(eq(signals.userId, creator))).toHaveLength(1);

    await caller().update({ id: created.id, paused: true });
    expect(await caller().sendTest({ id: created.id })).toMatchObject({
      accepted: false,
      error: 'Webhook is paused',
      status: 409,
    });
  });

  it('pages deliveries newest first', async () => {
    const created = await caller().create({ agentId });
    for (let i = 0; i < 22; i++)
      await db.insert(signals).values({
        agentId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        externalId: `${created.id}:e${i}`,
        payload: { body: { i } },
        scopeKey: `inbound-webhook:${created.id}`,
        source: 'webhook',
        type: 'webhook',
        userId: creator,
      });
    const first = await caller().listDeliveries({ id: created.id });
    expect(first.items).toHaveLength(20);
    expect(first.items[0].preview).toBe('{"i":21}');
    const second = await caller().listDeliveries({ cursor: first.nextCursor, id: created.id });
    expect(second.items.map((item) => item.preview)).toEqual(['{"i":1}', '{"i":0}']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('pages calls that share a millisecond without skipping any', async () => {
    const created = await caller().create({ agentId });
    // 21 calls within one millisecond, apart only in their microseconds.
    for (let i = 0; i < 21; i++)
      await db.execute(
        sql`insert into signals (agent_id, created_at, external_id, payload, scope_key, source, type, user_id)
            values (${agentId}, ${`2026-01-01T00:00:00.123${String(100 + i * 10).padStart(3, '0')}Z`}::timestamptz,
                    ${`${created.id}:u${i}`}, ${JSON.stringify({ body: { i } })}::jsonb,
                    ${`inbound-webhook:${created.id}`}, 'webhook', 'webhook', ${creator})`,
      );
    const first = await caller().listDeliveries({ id: created.id });
    const second = await caller().listDeliveries({ cursor: first.nextCursor, id: created.id });
    expect(first.nextCursor?.createdAt).toMatch(/\.\d{6}Z$/);
    expect([...first.items, ...second.items].map((item) => item.preview)).toHaveLength(21);
  });
});
