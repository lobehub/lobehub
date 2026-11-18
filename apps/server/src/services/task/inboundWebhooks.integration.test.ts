// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agents, tasks, topics, trashItems, userConnectors, users } from '@/database/schemas';

import { TaskBatchService } from './batch';
import { TaskService } from './index';

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
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const db = await getTestDB();
const userId = 'task-inbound-user';
const agentId = 'task-inbound-agent';
const connectorId = '984d0de2-6a14-423b-b949-a40d8bb30bd5';
const webhookModel = new InboundWebhookModel(db, userId, undefined, boundary.gateKeeper);
const taskModel = new TaskModel(db, userId);
const taskTopicModel = new TaskTopicModel(db, userId);
const single = new TaskService(db, userId);
const batch = new TaskBatchService(db, userId);
const seed = async (name = 'Remove task') => {
  const task = await taskModel.create({ instruction: 'Do the thing', name });
  const topicId = `task-webhook-topic-${task.id}`;
  await db.insert(topics).values({ id: topicId, agentId, userId });
  await taskTopicModel.add(task.id, topicId, { seq: 1 });
  await taskTopicModel.updateStatus(task.id, topicId, 'completed');
  const webhook = await webhookModel.create({
    agentId,
    topicId,
    connectorId,
    config: { eventName: 'issue.created', arguments: {} },
    kind: 'mcp_events',
    secret: 'whsec_task',
    status: 'active',
    verification: { scheme: 'standard_webhooks' },
  });
  return { task, topicId, webhook };
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  boundary.unsubscribe.mockResolvedValue({});
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: agentId, userId });
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
  await db.execute(sql`DROP TRIGGER IF EXISTS reject_task_webhook_trash ON trash_items`);
  await db.execute(sql`DROP FUNCTION IF EXISTS reject_task_webhook_trash()`);
  await db.execute(sql`DROP TRIGGER IF EXISTS guard_task_webhook_trash ON tasks`);
  await db.execute(sql`DROP FUNCTION IF EXISTS guard_task_webhook_trash()`);
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

async function guardTaskStatusCAS() {
  await db.execute(sql`
    CREATE FUNCTION guard_task_webhook_trash() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.name = 'Guarded task' THEN RETURN NULL; END IF; RETURN NEW; END;
    $$
  `);
  await db.execute(sql`
    CREATE TRIGGER guard_task_webhook_trash BEFORE UPDATE ON tasks
    FOR EACH ROW WHEN (NEW.is_deleted IS TRUE) EXECUTE FUNCTION guard_task_webhook_trash()
  `);
}

describe('task deletion inbound webhook cleanup', () => {
  it.each(['single', 'batch'] as const)(
    'cleans the linked topic after a %s task deletion commits',
    async (mode) => {
      const { task, topicId, webhook } = await seed();
      const retained = await seed('Retained task');
      let committed = false;
      boundary.unsubscribe.mockImplementationOnce(async () => {
        const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
        const [root] = await db.select().from(trashItems).where(eq(trashItems.resourceId, task.id));
        committed = topic.isDeleted && !!root;
        return {};
      });
      if (mode === 'single') await single.deleteTask(task.id);
      else expect((await batch.delete([task.id])).updated).toEqual([task.id]);
      expect(committed).toBe(true);
      expect(boundary.unsubscribe).toHaveBeenCalledOnce();
      expect(await webhookModel.findById(webhook.id)).toBeUndefined();
      expect(await webhookModel.findById(retained.webhook.id)).toMatchObject({ status: 'active' });
    },
  );

  it('leaves the current operation topic and its subscription alive when a task deletes itself', async () => {
    const { task, topicId, webhook } = await seed();
    const keptTopicId = `task-webhook-kept-${task.id}`;
    await db.insert(topics).values({ id: keptTopicId, agentId, userId });
    await taskTopicModel.add(task.id, keptTopicId, { operationId: 'operation-kept', seq: 2 });
    await db
      .update(tasks)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(tasks.id, task.id));
    const kept = await webhookModel.create({
      agentId,
      topicId: keptTopicId,
      connectorId,
      config: { eventName: 'issue.created', arguments: {} },
      kind: 'mcp_events',
      secret: 'whsec_kept',
      status: 'active',
      verification: { scheme: 'standard_webhooks' },
    });
    await single.deleteTask(task.id, { keepOperationId: 'operation-kept' });
    expect((await db.select().from(topics).where(eq(topics.id, topicId)))[0].isDeleted).toBe(true);
    expect(
      (await db.select().from(topics).where(eq(topics.id, keptTopicId)))[0].isDeleted,
    ).not.toBe(true);
    expect(await webhookModel.findById(webhook.id)).toBeUndefined();
    expect(await webhookModel.findById(kept.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('only cleans the task IDs whose status compare-and-set succeeded in a partial batch', async () => {
    const removed = await seed();
    const guarded = await seed('Guarded task');
    await guardTaskStatusCAS();
    expect((await batch.delete([removed.task.id, guarded.task.id])).updated).toEqual([
      removed.task.id,
    ]);
    expect(await webhookModel.findById(removed.webhook.id)).toBeUndefined();
    expect(await webhookModel.findById(guarded.webhook.id)).toMatchObject({ status: 'active' });
    expect(
      (await db.select().from(topics).where(eq(topics.id, guarded.topicId)))[0].isDeleted,
    ).not.toBe(true);
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('preserves a subscription when the single-task status compare-and-set refuses deletion', async () => {
    const guarded = await seed('Guarded task');
    await guardTaskStatusCAS();
    await expect(single.deleteTask(guarded.task.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await webhookModel.findById(guarded.webhook.id)).toMatchObject({ status: 'active' });
    expect(boundary.unsubscribe).not.toHaveBeenCalled();
  });

  it.each(['single', 'batch'] as const)(
    'does not unsubscribe when a %s deletion rolls back before its registry commit',
    async (mode) => {
      const { task, topicId, webhook } = await seed();
      await db.execute(sql`
      CREATE FUNCTION reject_task_webhook_trash() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected task trash registry failure'; END;
      $$
    `);
      await db.execute(sql`
      CREATE TRIGGER reject_task_webhook_trash BEFORE INSERT ON trash_items
      FOR EACH ROW EXECUTE FUNCTION reject_task_webhook_trash()
    `);
      await expect(
        mode === 'single' ? single.deleteTask(task.id) : batch.delete([task.id]),
      ).rejects.toThrow();
      expect(await webhookModel.findById(webhook.id)).toMatchObject({ status: 'active' });
      expect((await db.select().from(topics).where(eq(topics.id, topicId)))[0].isDeleted).not.toBe(
        true,
      );
      expect(boundary.unsubscribe).not.toHaveBeenCalled();
    },
  );

  it('attempts remote teardown before hard-deleting one task topic', async () => {
    const { task, topicId, webhook } = await seed();
    let topicExisted = false;
    boundary.unsubscribe.mockImplementationOnce(async () => {
      topicExisted =
        (await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId))).length ===
        1;
      return {};
    });
    await single.deleteTopic(topicId);
    expect(topicExisted).toBe(true);
    expect(await taskModel.findById(task.id)).not.toBeNull();
    expect(await webhookModel.findById(webhook.id)).toBeUndefined();
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toEqual([]);
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps remote failures durable when deleting task topics through the recycle bin', async () => {
    const { task, webhook } = await seed();
    boundary.unsubscribe.mockRejectedValue(new Error('offline'));
    await single.deleteTask(task.id);
    expect(await webhookModel.findById(webhook.id)).toMatchObject({
      status: 'deleting',
      maintenanceFailures: 1,
    });
    expect(await webhookModel.query()).toEqual([]);
  });
});
