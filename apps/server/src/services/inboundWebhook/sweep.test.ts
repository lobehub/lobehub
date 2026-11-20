// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { CreateInboundWebhook } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import {
  agents,
  inboundWebhooks,
  signals,
  topics,
  userConnectors,
  users,
} from '@/database/schemas';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { maintainMcpSubscription } from './kinds/mcpEvents/subscription';
import { FEATURE_OFF_RECHECK_MS, sweepInboundWebhooks } from './sweep';

const boundary = vi.hoisted(() => ({
  enabled: vi.fn(),
  subscribe: vi.fn(),
  listTools: vi.fn(),
  unsubscribe: vi.fn(),
  schedule: vi.fn(),
  claimMaintenance: vi.fn(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gateKeeper },
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { inboundWebhook: { claimMaintenance: boundary.claimMaintenance } },
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    subscribeEvent: boundary.subscribe,
    unsubscribeEvent: boundary.unsubscribe,
    listRawTools: boundary.listTools,
    getEventsCapability: async () => ({ supported: true }),
  },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: async (connector: unknown) => connector,
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: async () => false }));
vi.mock('@/server/services/inboundWebhook/featureGate', () => ({
  isWebhookEnabled: boundary.enabled,
}));
vi.mock('./scheduler', () => ({ scheduleInboundWebhookWake: boundary.schedule }));
const db = await getTestDB();
const userId = 'sweep-user';
const agentId = 'sweep-agent';
const topicId = 'sweep-topic';
const connectorId = 'a62115ba-8359-4471-9415-b3872d527a29';
const model = new InboundWebhookModel(db, userId, undefined, boundary.gateKeeper);
const seed = (patch: Partial<CreateInboundWebhook> = {}) =>
  model.create({
    agentId,
    topicId,
    connectorId,
    config: { eventName: 'issue.created', arguments: {} },
    kind: 'mcp_events',
    verification: { scheme: 'standard_webhooks' },
    secret: 'whsec_sweep',
    status: 'active',
    ...patch,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  boundary.enabled.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boundary.listTools.mockResolvedValue([]);
  boundary.subscribe.mockResolvedValue({ id: 'remote', refreshBefore: null });
  boundary.unsubscribe.mockResolvedValue({});
  boundary.claimMaintenance.mockResolvedValue(true);
  boundary.schedule.mockResolvedValue(undefined);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
  await db.insert(topics).values({ id: topicId, agentId, userId });
  await db.insert(userConnectors).values({
    id: connectorId,
    userId,
    identifier: 'fixture',
    name: 'Fixture',
    sourceType: 'custom',
    status: 'connected',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
  });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

describe('connector status after webhook maintenance authentication', () => {
  it('evaluates each creator separately when one sweep contains enabled and disabled owners', async () => {
    const other = 'sweep-disabled-owner';
    const due = new Date(Date.now() - 1000);
    try {
      await db.insert(users).values({ id: other });
      await db.insert(agents).values({ id: other, userId: other });
      await db.insert(topics).values({ id: other, agentId: other, userId: other });
      const otherConnector = crypto.randomUUID();
      await db.insert(userConnectors).values({
        id: otherConnector,
        userId: other,
        identifier: 'other-fixture',
        name: 'Other',
        sourceType: 'custom',
        status: 'connected',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://mcp.example.com',
      });
      const otherModel = new InboundWebhookModel(db, other, undefined, boundary.gateKeeper);
      const suspended = await otherModel.create({
        agentId: other,
        topicId: other,
        connectorId: otherConnector,
        kind: 'mcp_events',
        config: { eventName: 'issue.created', arguments: {} },
        verification: { scheme: 'standard_webhooks' },
        secret: 'whsec_other',
        status: 'active',
        nextMaintenanceAt: due,
      });
      await seed({ nextMaintenanceAt: due });
      await seed({ nextMaintenanceAt: due });
      boundary.enabled.mockImplementation(async (owner: string) => owner === userId);
      await sweepInboundWebhooks(db);
      expect(boundary.subscribe).toHaveBeenCalledTimes(2);
      expect(boundary.enabled.mock.calls.map(([owner]) => owner).sort()).toEqual(
        [userId, other].sort(),
      );
      // Not maintained, only moved out of the next sweeps' way.
      expect(await otherModel.findById(suspended.id)).toEqual({
        ...suspended,
        accessedAt: expect.any(Date),
        nextMaintenanceAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(
        (await otherModel.findById(suspended.id))!.nextMaintenanceAt!.getTime(),
      ).toBeGreaterThan(Date.now());
    } finally {
      await db.delete(users).where(eq(users.id, other));
    }
  });

  it('skips renewal for disabled owners, caches per sweep and resumes from cursor once enabled', async () => {
    const due = new Date(Date.now() - 1000);
    const a = await seed({
      nextMaintenanceAt: due,
      maintenanceFailures: 2,
      state: { cursor: 'last-cursor', refreshBefore: due.toISOString() },
    });
    const b = await seed({ nextMaintenanceAt: due });
    boundary.enabled.mockResolvedValue(false);
    await sweepInboundWebhooks(db);
    expect(boundary.subscribe).not.toHaveBeenCalled();
    expect(boundary.enabled).toHaveBeenCalledExactlyOnceWith(userId);
    // Nothing about them changes but when they are looked at next.
    for (const row of [a, b])
      expect(await model.findById(row.id)).toEqual({
        ...row,
        accessedAt: expect.any(Date),
        nextMaintenanceAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    // The recheck delay later, with the feature back on.
    await db
      .update(inboundWebhooks)
      .set({ nextMaintenanceAt: due })
      .where(inArray(inboundWebhooks.id, [a.id, b.id]));
    boundary.enabled.mockClear().mockResolvedValue(true);
    await sweepInboundWebhooks(db);
    expect(boundary.enabled).toHaveBeenCalledExactlyOnceWith(userId);
    expect(boundary.subscribe).toHaveBeenCalledTimes(2);
    // Rows due at the same instant come back in no particular order; `a` resumes from its cursor.
    expect(boundary.subscribe.mock.calls.map(([, input]) => input.cursor)).toContain('last-cursor');
    expect(await model.findById(a.id)).toMatchObject({ status: 'active', maintenanceFailures: 0 });
  });

  it('reaches enabled owners behind a full batch of disabled-owner rows', async () => {
    const otherUser = 'sweep-disabled-owner';
    await db.insert(users).values({ id: otherUser });
    await db.insert(agents).values({ id: `${agentId}-2`, userId: otherUser });
    await db
      .insert(topics)
      .values({ agentId: `${agentId}-2`, id: `${topicId}-2`, userId: otherUser });
    const otherModel = new InboundWebhookModel(db, otherUser, undefined, boundary.gateKeeper);
    const early = new Date(Date.now() - 60_000);
    const disabled = await Promise.all(
      Array.from({ length: 120 }, () =>
        otherModel.create({
          agentId: `${agentId}-2`,
          config: { arguments: {}, eventName: 'issue.created' },
          kind: 'mcp_events',
          nextMaintenanceAt: early,
          secret: 'whsec_sweep',
          status: 'active',
          topicId: `${topicId}-2`,
          verification: { scheme: 'standard_webhooks' },
        }),
      ),
    );
    const enabled = await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.enabled.mockImplementation(async (owner: string) => owner === userId);
    try {
      await sweepInboundWebhooks(db);
      expect(boundary.subscribe).toHaveBeenCalledTimes(1);
      expect(await model.findById(enabled.id)).toMatchObject({ status: 'active' });
      // The skipped rows are not maintained (the kill switch), but they are rescheduled out of
      // the next sweep's way, so a long run of them cannot fill every bounded scan.
      expect(boundary.enabled).toHaveBeenCalledWith(otherUser);
      const next = (await otherModel.findById(disabled[0].id))?.nextMaintenanceAt;
      expect(next!.getTime()).toBeGreaterThan(Date.now() + FEATURE_OFF_RECHECK_MS - 60_000);
      expect(
        (await InboundWebhookModel.queryMaintenance(db, 1000)).map((row) => row.id),
      ).not.toContain(disabled[0].id);
    } finally {
      await db.delete(users).where(eq(users.id, otherUser));
    }
  });

  it('still retries remote teardown while the owner flag is disabled', async () => {
    const row = await seed({ status: 'deleting', nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.enabled.mockResolvedValue(false);
    await sweepInboundWebhooks(db);
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
    expect(await model.findById(row.id)).toBeUndefined();
  });

  it.each(['terminated', 'deleting'] as const)(
    'preserves concurrent %s during failed maintenance',
    async (status) => {
      const row = await seed();
      boundary.subscribe.mockImplementationOnce(async () => {
        await model.update(row.id, {
          status,
          lastError: 'access_revoked',
          nextMaintenanceAt: null,
        });
        throw new Error('upstream unavailable');
      });
      await maintainMcpSubscription({ db, model, row });
      expect(await model.findById(row.id)).toMatchObject({
        status,
        lastError: 'access_revoked',
        nextMaintenanceAt: null,
        maintenanceFailures: 0,
      });
    },
  );

  it.each(['terminated', 'deleting'] as const)(
    'preserves concurrent %s during successful maintenance',
    async (status) => {
      const row = await seed();
      boundary.subscribe.mockImplementationOnce(async () => {
        await model.update(row.id, {
          status,
          lastError: 'access_revoked',
          nextMaintenanceAt: null,
        });
        return { id: 'late-result', refreshBefore: new Date(Date.now() + 60_000).toISOString() };
      });
      await maintainMcpSubscription({ db, model, row });
      expect(await model.findById(row.id)).toMatchObject({
        status,
        lastError: 'access_revoked',
        nextMaintenanceAt: null,
        state: {},
      });
      expect((await model.findById(row.id))?.state).toEqual({});
    },
  );

  it.each([
    { status: 401 },
    { cause: { data: { type: 'AUTHORIZATION_ERROR' } } },
    { code: -32024, message: 'Forbidden' },
  ])('marks the connector error after confirmed auth failure %#', async (error) => {
    const row = await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.subscribe.mockRejectedValue(error);
    await sweepInboundWebhooks(db);
    expect(await model.findById(row.id)).toMatchObject({ status: 'error', lastError: 'auth' });
    expect(
      (await db.select().from(userConnectors).where(eq(userConnectors.id, connectorId)))[0].status,
    ).toBe('error');
  });

  it('returns to connected through the existing post-authorization tool sync', async () => {
    await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.subscribe.mockRejectedValue({ status: 401 });
    await sweepInboundWebhooks(db);
    expect(
      (await db.select().from(userConnectors).where(eq(userConnectors.id, connectorId)))[0].status,
    ).toBe('error');
    // OAuth persists fresh credentials before calling this same sync function.
    await syncConnectorToolsById(connectorId, {
      connectorModel: new ConnectorModel(db, userId),
      connectorToolModel: new ConnectorToolModel(db, userId),
      userId,
    });
    expect(
      (await db.select().from(userConnectors).where(eq(userConnectors.id, connectorId)))[0].status,
    ).toBe('connected');
  });

  it('preserves connected status on a non-auth transport failure', async () => {
    await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.subscribe.mockRejectedValue(new Error('network offline'));
    await sweepInboundWebhooks(db);
    expect(
      (await db.select().from(userConnectors).where(eq(userConnectors.id, connectorId)))[0].status,
    ).toBe('connected');
  });
});

describe('inbound webhook maintenance sweep', () => {
  it('renews due finite subscriptions without touching no-expiry endpoints', async () => {
    const finite = await seed({
      state: { refreshBefore: new Date(Date.now() + 60_000).toISOString(), cursor: 'cursor-7' },
      nextMaintenanceAt: new Date(Date.now() - 1000),
    });
    const forever = await seed({ state: { refreshBefore: null }, nextMaintenanceAt: null });
    expect(await sweepInboundWebhooks(db)).toEqual({ maintained: 1, wakes: 0 });
    expect(boundary.subscribe).toHaveBeenCalledOnce();
    expect(boundary.subscribe.mock.calls[0][1]).toMatchObject({
      cursor: 'cursor-7',
      maxAgeMs: 3_600_000,
      ttlMs: null,
    });
    expect(await model.findById(finite.id)).toMatchObject({
      state: { refreshBefore: null },
      nextMaintenanceAt: null,
    });
    expect(await model.findById(forever.id)).toMatchObject({
      state: { refreshBefore: null },
      nextMaintenanceAt: null,
    });
  });

  it('reschedules due disabled connectors without renewing remote state', async () => {
    const row = await seed({
      state: { refreshBefore: new Date().toISOString() },
      nextMaintenanceAt: new Date(Date.now() - 1000),
    });
    await db
      .update(userConnectors)
      .set({ isEnabled: false })
      .where(eq(userConnectors.id, connectorId));
    await sweepInboundWebhooks(db);
    expect(boundary.subscribe).not.toHaveBeenCalled();
    expect((await model.findById(row.id))?.nextMaintenanceAt?.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it.each(['http-status', 'normalized-client-error'] as const)(
    'backs off %s authentication failures with an actionable error status',
    async (shape) => {
      const row = await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
      boundary.subscribe.mockRejectedValue(
        shape === 'http-status'
          ? Object.assign(new Error('Unauthorized'), { status: 401 })
          : Object.assign(new Error('Error subscribing from MCP server'), {
              cause: Object.assign(
                new Error(
                  'MCP server authorization failed. Reconnect this MCP in your connector settings and try again.',
                ),
                { data: { type: 'AUTHORIZATION_ERROR' } },
              ),
            }),
      );
      await sweepInboundWebhooks(db);
      expect(await model.findById(row.id)).toMatchObject({
        status: 'error',
        lastError: 'auth',
        maintenanceFailures: 1,
      });
      expect((await model.findById(row.id))?.nextMaintenanceAt?.getTime()).toBeGreaterThan(
        Date.now(),
      );
    },
  );

  it('retries hidden remote deletions and cleans abandoned pending registrations', async () => {
    const deleting = await seed({
      status: 'deleting',
      maintenanceFailures: 1,
      nextMaintenanceAt: new Date(Date.now() - 1000),
    });
    const abandoned = await seed({
      status: 'pending',
      createdAt: new Date(Date.now() - 11 * 60_000),
    });
    const fresh = await seed({ status: 'pending' });
    await sweepInboundWebhooks(db);
    expect(await model.findById(deleting.id)).toBeUndefined();
    expect(await model.findById(abandoned.id)).toBeUndefined();
    expect(await model.findById(fresh.id)).toBeDefined();
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('skips a maintenance record already claimed by another worker', async () => {
    await seed({ nextMaintenanceAt: new Date(Date.now() - 1000) });
    boundary.claimMaintenance.mockResolvedValue(false);
    expect(await sweepInboundWebhooks(db)).toEqual({ maintained: 0, wakes: 0 });
    expect(boundary.subscribe).not.toHaveBeenCalled();
  });

  it('reschedules old pending/failed signals, excluding exhausted, processed and fresh events', async () => {
    const row = await seed();
    const old = new Date(Date.now() - 61_000);
    await db.insert(signals).values(
      [
        {
          externalId: 'sweep-pending',
          status: 'pending' as const,
          attempts: 9,
          updatedAt: old,
          scopeKey: `inbound-webhook:${row.id}`,
        },
        {
          externalId: 'sweep-failed',
          status: 'failed' as const,
          attempts: 2,
          updatedAt: old,
          scopeKey: `inbound-webhook:${row.id}`,
        },
        {
          externalId: 'sweep-exhausted',
          status: 'failed' as const,
          attempts: 3,
          updatedAt: old,
          scopeKey: 'inbound-webhook:exhausted',
        },
        {
          externalId: 'sweep-processed',
          status: 'processed' as const,
          attempts: 1,
          updatedAt: old,
          scopeKey: 'inbound-webhook:processed',
        },
        {
          externalId: 'sweep-fresh',
          status: 'pending' as const,
          attempts: 0,
          updatedAt: new Date(),
          scopeKey: 'inbound-webhook:fresh',
        },
      ].map((signal) => ({
        agentId,
        userId,
        source: 'mcp-events',
        type: 'issue.created',
        ...signal,
      })),
    );
    expect(await sweepInboundWebhooks(db)).toEqual({ maintained: 0, wakes: 1 });
    expect(boundary.schedule).toHaveBeenCalledExactlyOnceWith(row.id);
  });
});
