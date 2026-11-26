// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { ChannelRepository } from '@/database/repositories/channel';
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
  redisService: {
    inboundWebhook: {
      countDelivery: async () => 1,
      workspaceMemberCount: async (_id: string, read: () => Promise<number>) => read(),
    },
  },
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
/** A call to the webhook as a caller makes it: the key as a Bearer header, or none. */
const callWith = (id: string, key?: string) =>
  receiveInboundWebhook(db, {
    body: '{}',
    headers: new Headers(key ? { authorization: `Bearer ${key}` } : {}),
    id,
  });

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
  it('creates an active webhook, returning its fixed URL and, this once, its key', async () => {
    const { item, secret } = await caller().create({
      agentId,
      instructions: '  Triage it  ',
      name: 'CI',
    });
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
    // The URL holds no key: it never changes, and the key travels in a header.
    expect(item.endpoint).toBe(`https://app.test/api/webhooks/inbound/${item.id}`);
    expect(secret).toMatch(/^[\w-]{43}$/);
    expect((await callWith(item.id, secret)).status).toBe(202);
    expect((await callWith(item.id)).status).toBe(401);
    // Nothing returns the key again.
    const listed = await caller().list({ agentId });
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(JSON.stringify(await caller().update({ id: item.id, name: 'CI 2' }))).not.toContain(
      secret,
    );
  });

  it('keeps the identifier the Agent knows it by when people rename it', async () => {
    const { item } = await caller().create({ agentId, name: 'CI alerts' });
    expect(item).toMatchObject({ identifier: 'ci-alerts', name: 'CI alerts' });
    const renamed = await caller().update({ id: item.id, name: '夜间构建' });
    expect(renamed).toMatchObject({ identifier: 'ci-alerts', name: '夜间构建' });
    const moved = await caller().update({ autoApprove: true, id: item.id, topicMode: 'reuse' });
    expect(moved.identifier).toBe('ci-alerts');
  });

  it("never gives two of an agent's webhooks the same identifier", async () => {
    const first = await caller().create({ agentId, name: '告警' });
    const second = await caller().create({ agentId, name: '通知' });
    const third = await caller().create({ agentId, name: 'CI alerts' });
    const fourth = await caller().create({ agentId, name: 'CI  Alerts!' });
    expect([first, second, third, fourth].map(({ item }) => item.identifier)).toEqual([
      'webhook',
      'webhook-2',
      'ci-alerts',
      'ci-alerts-2',
    ]);
  });

  it('gives webhooks created at the same moment different identifiers', async () => {
    const created = await Promise.all(
      Array.from({ length: 3 }, () => caller().create({ agentId, name: 'CI alerts' })),
    );
    expect(created.map(({ item }) => item.identifier).sort()).toEqual([
      'ci-alerts',
      'ci-alerts-2',
      'ci-alerts-3',
    ]);
  });

  it('lists one kind when asked', async () => {
    const { item } = await caller().create({ agentId });
    expect((await caller().list({ kind: 'generic' })).map((row) => row.id)).toEqual([item.id]);
    expect(await caller().list({ kind: 'mcp_events' })).toEqual([]);
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

  it('shows the fixed URL to everyone who sees the agent, and the key to no one', async () => {
    const created = await inWorkspace(creator).create({ agentId: `${agentId}-ws` });
    const mine = await inWorkspace(creator).list({ agentId: `${agentId}-ws` });
    expect(mine.map((item) => item.endpoint)).toEqual([created.item.endpoint]);
    const theirs = await inWorkspace(colleague).list({ agentId: `${agentId}-ws` });
    expect(theirs).toMatchObject([
      {
        canConfigure: false,
        canManage: false,
        endpoint: created.item.endpoint,
        id: created.item.id,
      },
    ]);
    // The URL alone runs nothing: only the creator ever saw the key, and only once.
    const admin = await inWorkspace(colleague, 'admin').list({ agentId: `${agentId}-ws` });
    expect(admin).toMatchObject([
      { canConfigure: false, canManage: true, endpoint: created.item.endpoint },
    ]);
    expect(JSON.stringify([mine, theirs, admin])).not.toContain(created.secret);
    expect(await inWorkspace(creator).list({ agentId: 'another-agent' })).toEqual([]);

    const actions = await db
      .select({ action: workspaceAuditLogs.action })
      .from(workspaceAuditLogs)
      .where(eq(workspaceAuditLogs.resourceId, created.item.id));
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
    expect(seen).toMatchObject({
      agent: null,
      endpoint: null,
      id: created.item.id,
      instructions: null,
    });
    const [own] = await inWorkspace(creator).list();
    expect(own).toMatchObject({
      endpoint: created.item.endpoint,
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
      admin.update({ autoApprove: true, id: created.item.id, instructions: 'Export everything' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(admin.sendTest({ id: created.item.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(admin.rotateToken({ id: created.item.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(admin.listDeliveries({ id: created.item.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await admin.update({ id: created.item.id, paused: true })).status).toBe('paused');

    const [own] = await inWorkspace(creator).list();
    expect(own).toMatchObject({ instructions: null, source: { autoApprove: false } });
    // The key was not replaced either: it still authenticates (409: the webhook is paused now).
    expect((await callWith(created.item.id, created.secret)).status).toBe(409);
    expect((await callWith(created.item.id, 'not-the-key')).status).toBe(401);
  });

  it("keeps what another member's webhook runs out of an admin's hands, even on a public agent", async () => {
    const created = await inWorkspace(creator).create({
      agentId: `${agentId}-ws`,
      instructions: 'Triage CI',
    });
    const admin = inWorkspace(colleague, 'admin');

    for (const attempt of [
      () =>
        admin.update({ autoApprove: true, id: created.item.id, instructions: 'Export everything' }),
      () => admin.sendTest({ id: created.item.id }),
      () => admin.rotateToken({ id: created.item.id }),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect((await admin.update({ id: created.item.id, paused: true })).status).toBe('paused');
    const [own] = await inWorkspace(creator).list({ agentId: `${agentId}-ws` });
    expect(own).toMatchObject({
      canConfigure: true,
      endpoint: created.item.endpoint,
      instructions: 'Triage CI',
      source: { autoApprove: false },
    });
    await admin.delete({ id: created.item.id });
    expect(await inWorkspace(creator).list({ agentId: `${agentId}-ws` })).toEqual([]);
  });

  it('pauses, resumes and changes settings, leaving the URL as it was', async () => {
    const created = await caller().create({ agentId });
    const paused = await caller().update({ id: created.item.id, paused: true });
    expect(paused.status).toBe('paused');
    const changed = await caller().update({
      autoApprove: true,
      id: created.item.id,
      name: '',
      paused: false,
      topicMode: 'reuse',
    });
    expect(changed).toMatchObject({
      endpoint: created.item.endpoint,
      name: null,
      source: { autoApprove: true, kind: 'generic', topicMode: 'reuse' },
      status: 'active',
    });
  });

  it('gives a new key, shown once, that replaces the old one at once while the URL stays', async () => {
    const created = await caller().create({ agentId });
    const rotated = await caller().rotateToken({ id: created.item.id });
    expect(rotated.item.endpoint).toBe(created.item.endpoint);
    expect(rotated.secret).not.toBe(created.secret);
    expect((await callWith(created.item.id, created.secret)).status).toBe(401);
    expect((await callWith(created.item.id, rotated.secret)).status).toBe(202);
  });

  it("lets only the webhook's managers change it", async () => {
    const created = await inWorkspace(creator).create({ agentId: `${agentId}-ws` });
    for (const run of [
      () => inWorkspace(colleague).update({ id: created.item.id, paused: true }),
      () => inWorkspace(colleague).rotateToken({ id: created.item.id }),
      () => inWorkspace(colleague).sendTest({ id: created.item.id }),
      () => inWorkspace(colleague).listDeliveries({ id: created.item.id }),
    ])
      await expect(run()).rejects.toBeInstanceOf(TRPCError);
    await expect(
      inWorkspace(colleague, 'admin').update({ id: created.item.id, paused: true }),
    ).resolves.toMatchObject({ status: 'paused' });
  });

  it("continues a picked topic in reuse mode, only one of the creator's own for this agent", async () => {
    await db.insert(agents).values({ id: `${agentId}-other`, userId: creator });
    await db.insert(topics).values([
      { agentId, id: 'picked-topic', title: 'On-call log', userId: creator },
      { agentId: `${agentId}-other`, id: 'foreign-topic', userId: creator },
    ]);
    const { item } = await caller().create({
      agentId,
      topicId: 'picked-topic',
      topicMode: 'reuse',
    });
    expect(item).toMatchObject({
      source: { topicId: 'picked-topic', topicMode: 'reuse' },
      topic: { id: 'picked-topic', title: 'On-call log' },
    });

    await expect(
      caller().create({ agentId, topicId: 'foreign-topic', topicMode: 'reuse' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller().update({ id: item.id, topicId: 'foreign-topic' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // A new topic per call keeps no picked topic; clearing drops it as well.
    expect((await caller().update({ id: item.id, topicMode: 'new' })).source).not.toHaveProperty(
      'topicId',
    );
    await caller().update({ id: item.id, topicId: 'picked-topic', topicMode: 'reuse' });
    expect((await caller().update({ id: item.id, topicId: null })).source).not.toHaveProperty(
      'topicId',
    );
  });

  it('stops showing a picked topic once it is trashed or moved, keeping the choice', async () => {
    await db.insert(agents).values({ id: `${agentId}-other`, userId: creator });
    await db
      .insert(topics)
      .values({ agentId, id: 'picked-topic', title: 'On-call log', userId: creator });
    const { item } = await caller().create({
      agentId,
      topicId: 'picked-topic',
      topicMode: 'reuse',
    });

    await db.update(topics).set({ isDeleted: true }).where(eq(topics.id, 'picked-topic'));
    expect((await caller().list({ agentId }))[0]).toMatchObject({
      id: item.id,
      source: { topicId: 'picked-topic' },
      topic: null,
    });

    await db
      .update(topics)
      .set({ agentId: `${agentId}-other`, isDeleted: false })
      .where(eq(topics.id, 'picked-topic'));
    expect((await caller().list({ agentId }))[0].topic).toBeNull();
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
    expect(await caller().sendTest({ id: created.item.id })).toEqual({
      accepted: true,
      error: undefined,
      status: 202,
    });
    const page = await caller().listDeliveries({ id: created.item.id });
    expect(page.items).toMatchObject([
      { payloadPurged: false, status: 'pending', test: true, threadKey: null, topic: null },
    ]);
    expect(page.items[0].preview).toContain('test delivery');
    expect(await db.select().from(signals).where(eq(signals.userId, creator))).toHaveLength(1);

    await caller().update({ id: created.item.id, paused: true });
    expect(await caller().sendTest({ id: created.item.id })).toMatchObject({
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
        externalId: `${created.item.id}:e${i}`,
        payload: { body: { i } },
        scopeKey: `inbound-webhook:${created.item.id}`,
        source: 'webhook',
        type: 'webhook',
        userId: creator,
      });
    const first = await caller().listDeliveries({ id: created.item.id });
    expect(first.items).toHaveLength(20);
    expect(first.items[0].preview).toBe('{"i":21}');
    const second = await caller().listDeliveries({ cursor: first.nextCursor, id: created.item.id });
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
                    ${`${created.item.id}:u${i}`}, ${JSON.stringify({ body: { i } })}::jsonb,
                    ${`inbound-webhook:${created.item.id}`}, 'webhook', 'webhook', ${creator})`,
      );
    const first = await caller().listDeliveries({ id: created.item.id });
    const second = await caller().listDeliveries({ cursor: first.nextCursor, id: created.item.id });
    expect(first.nextCursor?.createdAt).toMatch(/\.\d{6}Z$/);
    expect([...first.items, ...second.items].map((item) => item.preview)).toHaveLength(21);
  });
});

describe('Channel delivery (CLI and agent tools; read-only on the Web)', () => {
  const directChannel = async () => {
    const { channel } = await new ChannelRepository(db, creator).create({
      agentConfig: {},
      agentId,
      title: 'Nightly',
    });
    const root = await new ChannelRepository(db, creator).send(channel.id, {
      content: 'Build status for the nightly run',
      requestKey: 'root',
      routing: 'fallback',
    });
    const thread = await new ChannelRepository(db, creator).createThread(channel.id, {
      rootMessageId: root.id,
    });
    return { channelId: channel.id, threadId: thread.id };
  };

  it('needs auto-approval: nobody can approve a tool call in the Channel', async () => {
    const { channelId } = await directChannel();
    await expect(caller().create({ agentId, delivery: { channelId } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const { item } = await caller().create({
      agentId,
      autoApprove: true,
      delivery: { channelId },
    });
    // Turning auto-approval off while it still posts to the Channel is refused too.
    await expect(caller().update({ autoApprove: false, id: item.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const cleared = await caller().update({ autoApprove: false, delivery: null, id: item.id });
    expect(cleared).toMatchObject({ channel: null, source: { autoApprove: false } });
    expect(cleared.source).not.toHaveProperty('delivery');
  });

  it('names the Channel and Thread it posts to for members, and hides them from others', async () => {
    const { channelId, threadId } = await directChannel();
    const { item } = await caller().create({
      agentId,
      autoApprove: true,
      delivery: { channelId, threadId },
    });
    expect(item.channel).toEqual({
      id: channelId,
      projectId: null,
      threadId,
      threadTitle: 'Build status for the nightly run',
      title: 'Nightly',
    });
    expect(item.source).toMatchObject({ delivery: { channelId, threadId } });
  });

  it('refuses a Channel the creator is not in, or a Thread of another Channel', async () => {
    const { channelId } = await directChannel();
    await expect(
      caller(colleague).create({ agentId, autoApprove: true, delivery: { channelId } }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/BAD_REQUEST|NOT_FOUND|FORBIDDEN/) });
    await expect(
      caller().create({
        agentId,
        autoApprove: true,
        delivery: { channelId, threadId: 'cht_elsewhere' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Thread not found in that Channel.' });
  });
});
