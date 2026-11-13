// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateInboundWebhook } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { agents, topics, userConnectors, users } from '@/database/schemas';

import {
  refreshByConnector,
  removeByAgent,
  removeByConnector,
  removeByTopics,
  removeInboundWebhook,
} from './lifecycle';

const boundary = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gateKeeper },
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: { unsubscribeEvent: boundary.unsubscribe, subscribeEvent: boundary.subscribe },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: async (connector: unknown) => connector,
}));
const db = await getTestDB();
const userId = 'lifecycle-user';
const scope = { userId };
const agentId = 'lifecycle-agent';
const topicId = 'lifecycle-topic';
const secondAgentId = 'lifecycle-second-agent';
const secondTopicId = 'lifecycle-second-topic';
const connectorId = '4fa07c19-a745-4e7c-b264-3bf016cf3c9e';
const secondConnectorId = '92f1c979-a968-4c25-b937-50b4c84b95f4';
const model = new InboundWebhookModel(db, userId, undefined, boundary.gateKeeper);
const seed = (patch: Partial<CreateInboundWebhook> = {}) =>
  model.create({
    agentId,
    topicId,
    connectorId,
    kind: 'mcp_events',
    config: { eventName: 'issue.created', arguments: {} },
    verification: { scheme: 'standard_webhooks' },
    secret: 'whsec_lifecycle',
    status: 'active',
    ...patch,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boundary.unsubscribe.mockResolvedValue({});
  boundary.subscribe.mockResolvedValue({ id: 'remote-refreshed', refreshBefore: null });
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values([
    { id: agentId, userId },
    { id: secondAgentId, userId },
  ]);
  await db.insert(topics).values([
    { id: topicId, agentId, userId },
    { id: secondTopicId, agentId: secondAgentId, userId },
  ]);
  await db.insert(userConnectors).values(
    [connectorId, secondConnectorId].map((id) => ({
      id,
      userId,
      identifier: `fixture-${id}`,
      name: 'Fixture',
      sourceType: 'custom',
      status: 'connected',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com',
    })),
  );
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

describe('inbound webhook lifecycle', () => {
  it('removes a subscription only after attempting remote teardown', async () => {
    const row = await seed();
    let wasHiddenDuringTeardown = false;
    boundary.unsubscribe.mockImplementationOnce(async () => {
      wasHiddenDuringTeardown = (await model.query()).length === 0;
      return {};
    });
    await removeInboundWebhook(db, row);
    expect(wasHiddenDuringTeardown).toBe(true);
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
    expect(await model.findById(row.id)).toBeUndefined();
  });

  it('keeps failed teardowns hidden and durable, then removes them on the fifth failure', async () => {
    const row = await seed();
    boundary.unsubscribe.mockRejectedValue(new Error('offline'));
    await removeInboundWebhook(db, row);
    expect(await model.findById(row.id)).toMatchObject({
      status: 'deleting',
      maintenanceFailures: 1,
    });
    expect((await model.findById(row.id))?.nextMaintenanceAt).toBeInstanceOf(Date);
    expect(await model.query()).toEqual([]);
    for (let attempt = 1; attempt < 5; attempt++) {
      const current = await model.findById(row.id);
      if (!current) throw new Error('Deletion retries lost their durable record');
      await removeInboundWebhook(db, current);
    }
    expect(await model.findById(row.id)).toBeUndefined();
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(5);
  });

  it('finishes a deletion after remote service recovers', async () => {
    const row = await seed();
    boundary.unsubscribe.mockRejectedValueOnce(new Error('offline'));
    await removeInboundWebhook(db, row);
    const deleting = await model.findById(row.id);
    if (!deleting) throw new Error('Expected durable teardown');
    await removeInboundWebhook(db, deleting);
    expect(await model.findById(row.id)).toBeUndefined();
  });

  it.each(['connector', 'agent', 'topic'] as const)(
    'cleans only rows bound to the removed %s',
    async (resource) => {
      const target = await seed();
      const retained = await seed({
        agentId: secondAgentId,
        topicId: secondTopicId,
        connectorId: secondConnectorId,
      });
      if (resource === 'connector') await removeByConnector(db, scope, connectorId);
      else if (resource === 'agent') await removeByAgent(db, scope, agentId);
      else await removeByTopics(db, scope, [topicId]);
      expect(await model.findById(target.id)).toBeUndefined();
      expect(await model.findById(retained.id)).toBeDefined();
      expect(boundary.unsubscribe).toHaveBeenCalledOnce();
    },
  );

  it('re-registers no-expiry subscriptions when connector credentials change, excluding terminated rows', async () => {
    const active = await seed({ state: { refreshBefore: null }, nextMaintenanceAt: null });
    const terminated = await seed({ status: 'terminated' });
    await refreshByConnector(db, scope, connectorId);
    expect(boundary.subscribe).toHaveBeenCalledOnce();
    expect(await model.findById(active.id)).toMatchObject({
      status: 'active',
      nextMaintenanceAt: null,
      state: { remoteSubscriptionId: 'remote-refreshed' },
    });
    expect((await model.findById(terminated.id))?.status).toBe('terminated');
  });
});
