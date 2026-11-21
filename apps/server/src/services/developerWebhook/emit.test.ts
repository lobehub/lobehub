// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookEndpointModel } from '@/database/models/developerWebhook';
import { users, webhookDeliveries } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type * as EmitModule from './emit';
import { emitWebhookEvent, invalidateWebhookScope } from './emit';
import { publishRunCompletionWebhook, publishRunStartedWebhook } from './runEvents';

const mocks = vi.hoisted(() => ({ published: vi.fn(), triggerDeliver: vi.fn() }));
vi.mock('@/server/workflows/developerWebhook', () => ({
  DeveloperWebhookWorkflow: { triggerDeliver: mocks.triggerDeliver },
}));
// runEvents publishes through this; emitWebhookEvent stays real.
vi.mock('./emit', async (importOriginal) => ({
  ...(await importOriginal<typeof EmitModule>()),
  publishWebhookEvent: mocks.published,
}));
const published = mocks.published;

const userId = 'webhook-emit-user';
const otherUserId = 'webhook-emit-other';
let db: LobeChatDatabase;

const endpoint = (owner: string, events: Parameters<WebhookEndpointModel['create']>[0]['events']) =>
  new WebhookEndpointModel(db, owner).create({
    events,
    secret: 'cipher:s',
    secretHint: 's',
    url: 'https://example.com/hook',
  });

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  mocks.triggerDeliver.mockReset();
  invalidateWebhookScope({ userId });
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('emitWebhookEvent', () => {
  it('queues one delivery per subscribed endpoint of the owner, and nothing for others', async () => {
    const subscribed = await endpoint(userId, ['task.status_changed']);
    await endpoint(userId, ['goal.status_changed']);
    await endpoint(otherUserId, ['task.status_changed']);

    const data = { identifier: 'T-9', previousStatus: 'todo', status: 'running', taskId: 'task_9' };
    const ids = await emitWebhookEvent(db, { userId }, 'task.status_changed', data);

    expect(ids).toHaveLength(1);
    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, ids[0]));
    expect(delivery).toMatchObject({
      endpointId: subscribed.id,
      eventType: 'task.status_changed',
      status: 'pending',
    });
    expect(delivery.eventId).toMatch(/^evt_/);
    expect(delivery.payload).toEqual({
      createdAt: expect.any(String),
      data,
      id: delivery.eventId,
      type: 'task.status_changed',
      workspaceId: null,
    });
    expect(mocks.triggerDeliver).toHaveBeenCalledExactlyOnceWith({
      deliveryId: delivery.id,
      endpointId: subscribed.id,
    });
  });

  it('records a delivery the queue refuses as failed instead of leaving it pending', async () => {
    await endpoint(userId, ['topic.created']);
    mocks.triggerDeliver.mockRejectedValueOnce(new Error('QStash unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const [id] = await emitWebhookEvent(db, { userId }, 'topic.created', {
      agentId: null,
      title: 'Hello',
      topicId: 'tpc_1',
    });

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id));
    expect(delivery).toMatchObject({ error: 'Could not queue the delivery', status: 'failed' });
    error.mockRestore();
  });

  it('skips the endpoint lookup for a while once a space has no endpoint', async () => {
    const data = { agentId: null, title: 't', topicId: 'tpc_x' };
    expect(await emitWebhookEvent(db, { userId }, 'topic.created', data)).toEqual([]);

    // Written straight to the table, so nothing tells the emitter: the note still holds.
    await endpoint(userId, ['topic.created']);
    expect(await emitWebhookEvent(db, { userId }, 'topic.created', data)).toEqual([]);

    // The service invalidates it on every create / update / delete.
    invalidateWebhookScope({ userId });
    expect(await emitWebhookEvent(db, { userId }, 'topic.created', data)).toHaveLength(1);
  });

  it('does nothing when nobody subscribes', async () => {
    expect(await emitWebhookEvent(db, { userId }, 'file.parsed', {} as never)).toEqual([]);
    expect(mocks.triggerDeliver).not.toHaveBeenCalled();
  });
});

describe('run events', () => {
  const ctx = {
    agentId: 'agt_1',
    assistantMessageId: 'msg_2',
    error: 'Rate limited',
    operationId: 'op_1',
    steps: 3,
    topicId: 'tpc_1',
    userId,
    workspaceId: 'ws_1',
  };

  beforeEach(() => published.mockReset());

  it.each([
    ['done', 'run.completed', { assistantMessageId: 'msg_2', steps: 3 }],
    ['max_steps', 'run.completed', { assistantMessageId: 'msg_2', steps: 3 }],
    ['error', 'run.failed', { error: 'Rate limited' }],
    ['waiting_for_human', 'run.intervention_requested', {}],
  ])('reason %s → %s', (reason, type, extra) => {
    publishRunCompletionWebhook(db, reason, ctx);
    expect(published).toHaveBeenCalledExactlyOnceWith(db, { userId, workspaceId: 'ws_1' }, type, {
      agentId: 'agt_1',
      runId: 'op_1',
      topicId: 'tpc_1',
      ...extra,
    });
  });

  it.each(['interrupted', 'waiting_for_async_tool'])('reason %s has no event', (reason) => {
    publishRunCompletionWebhook(db, reason, ctx);
    expect(published).not.toHaveBeenCalled();
  });

  it('run.started', () => {
    publishRunStartedWebhook(db, ctx);
    expect(published).toHaveBeenCalledExactlyOnceWith(
      db,
      { userId, workspaceId: 'ws_1' },
      'run.started',
      { agentId: 'agt_1', runId: 'op_1', topicId: 'tpc_1' },
    );
  });
});
