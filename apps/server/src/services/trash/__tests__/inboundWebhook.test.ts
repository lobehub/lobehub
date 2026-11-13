// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import {
  agents,
  agentsToSessions,
  sessions,
  signals,
  topics,
  trashItems,
  userConnectors,
  users,
} from '@/database/schemas';
import type { WebhookWakeDeps } from '@/server/services/inboundWebhook/waker';
import { wakeInboundWebhook } from '@/server/services/inboundWebhook/waker';

import { TrashService } from '../index';

const boundary = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  gateKeeper: {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => ({ plaintext: value.slice(7) }),
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => boundary.gateKeeper },
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: { unsubscribeEvent: boundary.unsubscribe },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: async (connector: unknown) => connector,
}));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/redis', () => ({ redisService: { inboundWebhook: {} } }));
vi.mock('@/server/workflows/inboundWebhook', () => ({ InboundWebhookWorkflow: {} }));

const db = await getTestDB();
const userId = 'trash-webhook-user';
const otherUserId = 'trash-webhook-outsider';
const agentId = 'trash-webhook-agent';
const otherAgentId = 'trash-webhook-retained-agent';
const sessionId = 'trash-webhook-session';
const otherSessionId = 'trash-webhook-retained-session';
const topicId = 'trash-webhook-topic';
const retainedTopicId = 'trash-webhook-retained-topic';
const connectorId = 'e38bad4e-cfc8-466c-812b-f309600668fb';
const service = new TrashService(db, userId);
const model = new InboundWebhookModel(db, userId, undefined, boundary.gateKeeper);
const seedWebhook = (targetTopicId = topicId, targetAgentId = agentId) =>
  model.create({
    agentId: targetAgentId,
    topicId: targetTopicId,
    connectorId,
    config: { arguments: {}, eventName: 'issue.created' },
    kind: 'mcp_events',
    secret: 'whsec_trash',
    status: 'active',
    verification: { scheme: 'standard_webhooks' },
  });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boundary.unsubscribe.mockResolvedValue({});
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(agents).values([
    { id: agentId, userId, title: 'Removed agent' },
    { id: otherAgentId, userId, title: 'Retained agent' },
  ]);
  await db.insert(sessions).values([
    { id: sessionId, userId },
    { id: otherSessionId, userId },
  ]);
  await db.insert(agentsToSessions).values({ agentId, sessionId, userId });
  await db.insert(topics).values([
    { id: topicId, agentId, sessionId, userId, title: 'Removed topic' },
    {
      id: retainedTopicId,
      agentId: otherAgentId,
      sessionId: otherSessionId,
      userId,
      title: 'Retained topic',
    },
  ]);
  await db.insert(userConnectors).values({
    id: connectorId,
    userId,
    identifier: 'linear',
    name: 'Linear',
    sourceType: 'custom',
    status: 'connected',
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
  });
});

afterEach(async () => {
  // The fault injector is scoped to this file's private PGlite DB and always removed.
  await db.execute(sql`DROP TRIGGER IF EXISTS reject_inbound_trash_registration ON trash_items`);
  await db.execute(sql`DROP FUNCTION IF EXISTS reject_inbound_trash_registration()`);
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  vi.restoreAllMocks();
});

describe('TrashService inbound webhook hooks', () => {
  it('cleans the actual trashed topic after its registry transaction commits', async () => {
    const removed = await seedWebhook();
    const retained = await seedWebhook(retainedTopicId, otherAgentId);
    let observedCommit = false;
    boundary.unsubscribe.mockImplementationOnce(async () => {
      const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
      const [registry] = await db
        .select()
        .from(trashItems)
        .where(eq(trashItems.resourceId, topicId));
      observedCommit = topic.isDeleted && !!registry;
      return {};
    });
    const roots = await service.trashTopics([topicId]);
    expect(roots.map((root) => root.resourceId)).toEqual([topicId]);
    expect(observedCommit).toBe(true);
    expect(await model.findById(removed.id)).toBeUndefined();
    expect(await model.findById(retained.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('cleans every topic selected through a legacy session, including its other-agent topics', async () => {
    const secondTopic = 'trash-webhook-shared-session-topic';
    await db.insert(topics).values({ id: secondTopic, agentId: otherAgentId, sessionId, userId });
    const removed = await seedWebhook();
    const second = await seedWebhook(secondTopic, otherAgentId);
    const retained = await seedWebhook(retainedTopicId, otherAgentId);
    const roots = await service.trashTopicsBySession(sessionId);
    expect(new Set(roots.map((root) => root.resourceId))).toEqual(new Set([topicId, secondTopic]));
    expect(await model.findById(removed.id)).toBeUndefined();
    expect(await model.findById(second.id)).toBeUndefined();
    expect(await model.findById(retained.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('cleans agent-native and unassigned legacy topics selected by trashTopicsByAgent', async () => {
    const legacyTopic = 'trash-webhook-legacy-topic';
    await db.insert(topics).values({ id: legacyTopic, agentId: null, sessionId, userId });
    const native = await seedWebhook();
    const legacy = await seedWebhook(legacyTopic);
    const retained = await seedWebhook(retainedTopicId, otherAgentId);
    const roots = await service.trashTopicsByAgent(agentId, { legacySessionId: sessionId });
    expect(new Set(roots.map((root) => root.resourceId))).toEqual(new Set([topicId, legacyTopic]));
    expect(await model.findById(native.id)).toBeUndefined();
    expect(await model.findById(legacy.id)).toBeUndefined();
    expect(await model.findById(retained.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('cleans agent roots and child topics in its linked sessions without deleting retained subscriptions', async () => {
    const crossLinkedTopic = 'trash-webhook-cascaded-other-agent-topic';
    await db
      .insert(topics)
      .values({ id: crossLinkedTopic, agentId: otherAgentId, sessionId, userId });
    const native = await seedWebhook();
    // Its target agent is retained; only the actual child-topic cascade identifies this endpoint.
    const child = await seedWebhook(crossLinkedTopic, otherAgentId);
    const retained = await seedWebhook(retainedTopicId, otherAgentId);
    const root = await service.trashAgent(agentId);
    expect(root).toMatchObject({ resourceType: 'agent', resourceId: agentId });
    if (!root) throw new Error('Expected the agent trash root');
    const children = await db.select().from(trashItems).where(eq(trashItems.rootId, root.id));
    expect(children.map((item) => item.resourceId)).toEqual(
      expect.arrayContaining([topicId, crossLinkedTopic]),
    );
    expect(await model.findById(native.id)).toBeUndefined();
    expect(await model.findById(child.id)).toBeUndefined();
    expect(await model.findById(retained.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it.each(['topic', 'agent'] as const)(
    'keeps failed %s teardown hidden and prevents any pending event from waking the deleted target',
    async (target) => {
      const webhook = await seedWebhook();
      await db.insert(signals).values({
        userId,
        agentId,
        externalId: `${webhook.id}:evt-1`,
        source: 'mcp-events',
        type: 'issue.created',
        scopeKey: `inbound-webhook:${webhook.id}`,
        payload: { issue: 123 },
      });
      boundary.unsubscribe.mockRejectedValue(new Error('remote unavailable'));
      if (target === 'topic') await service.trashTopics([topicId]);
      else await service.trashAgent(agentId);
      expect(await model.findById(webhook.id)).toMatchObject({
        status: 'deleting',
        maintenanceFailures: 1,
      });
      expect(await model.query()).toEqual([]);
      expect(boundary.unsubscribe).toHaveBeenCalledOnce();
      const execute = vi.fn<NonNullable<WebhookWakeDeps['execute']>>();
      expect(await wakeInboundWebhook(db, webhook.id, { execute })).toEqual({ outcome: 'gone' });
      expect(execute).not.toHaveBeenCalled();
      const [signal] = await db
        .select()
        .from(signals)
        .where(eq(signals.externalId, `${webhook.id}:evt-1`));
      expect(signal).toMatchObject({ status: 'ignored', error: 'webhook_removed' });
    },
  );

  it('does not recreate a subscription when its topic is restored from the recycle bin', async () => {
    const webhook = await seedWebhook();
    const [root] = await service.trashTopics([topicId]);
    const restored = await service.restore([root.id]);
    expect(restored.failed).toEqual([]);
    expect(restored.restored.map((item) => item.resourceId)).toEqual([topicId]);
    expect((await db.select().from(topics).where(eq(topics.id, topicId)))[0].isDeleted).not.toBe(
      true,
    );
    expect(await model.findById(webhook.id)).toBeUndefined();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('leaves subscriptions intact when a caller cannot trash the actual topic', async () => {
    const webhook = await seedWebhook();
    expect(await new TrashService(db, otherUserId).trashTopics([topicId])).toEqual([]);
    expect(await model.findById(webhook.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).not.toHaveBeenCalled();
  });

  it.each(['topic', 'agent'] as const)(
    'does not tear down subscriptions when the %s trash transaction rolls back',
    async (target) => {
      const webhook = await seedWebhook();
      await db.execute(sql`
      CREATE FUNCTION reject_inbound_trash_registration() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected trash registry failure'; END;
      $$
    `);
      await db.execute(sql`
      CREATE TRIGGER reject_inbound_trash_registration BEFORE INSERT ON trash_items
      FOR EACH ROW EXECUTE FUNCTION reject_inbound_trash_registration()
    `);
      const remove =
        target === 'topic' ? service.trashTopics([topicId]) : service.trashAgent(agentId);
      await expect(remove).rejects.toThrow();
      expect(await model.findById(webhook.id)).toMatchObject({ status: 'active' });
      expect(boundary.unsubscribe).not.toHaveBeenCalled();
      expect((await db.select().from(topics).where(eq(topics.id, topicId)))[0].isDeleted).not.toBe(
        true,
      );
      expect((await db.select().from(agents).where(eq(agents.id, agentId)))[0].isDeleted).not.toBe(
        true,
      );
      expect(await db.select().from(trashItems)).toEqual([]);
    },
  );
});
