// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  type DatabaseEventListener,
  instrumentDatabaseEvents,
  setDatabaseEventListener,
} from '../../events';
import { users, webhookDeliveries, webhookEndpoints, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WebhookDeliveryWorkerModel, WebhookEndpointModel } from '../developerWebhook';
import { GoalModel } from '../goal';
import { MessageModel } from '../message';
import { NotificationModel } from '../notification';
import { TaskModel } from '../task';
import { TopicModel } from '../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'developer-webhook-model-user';
const otherUserId = 'developer-webhook-model-other';
const workspaceId = 'developer-webhook-model-ws';

const endpointInput = (url = 'https://example.com/hook') => ({
  events: ['task.status_changed' as const, 'message.created' as const],
  secret: 'cipher:secret',
  secretHint: 'cret',
  url,
});

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Webhook workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  setDatabaseEventListener(undefined);
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('WebhookEndpointModel', () => {
  it('never returns the encrypted secret', async () => {
    const created = await new WebhookEndpointModel(serverDB, userId).create(endpointInput());
    expect(created).not.toHaveProperty('secret');
    expect(created).toMatchObject({ enabled: true, secretHint: 'cret', userId, workspaceId: null });
    expect(created.id).toMatch(/^whk_/);

    const [row] = await serverDB
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, created.id));
    expect(row.secret).toBe('cipher:secret');
  });

  it('isolates endpoints by owner and by space', async () => {
    const personal = new WebhookEndpointModel(serverDB, userId);
    const inWorkspace = new WebhookEndpointModel(serverDB, userId, workspaceId);
    const other = new WebhookEndpointModel(serverDB, otherUserId);
    const otherInWorkspace = new WebhookEndpointModel(serverDB, otherUserId, workspaceId);

    const mine = await personal.create(endpointInput('https://a.example.com'));
    const mineInWs = await inWorkspace.create(endpointInput('https://b.example.com'));

    expect((await personal.list({ limit: 10, offset: 0 })).items.map((e) => e.id)).toEqual([
      mine.id,
    ]);
    expect((await inWorkspace.list({ limit: 10, offset: 0 })).items.map((e) => e.id)).toEqual([
      mineInWs.id,
    ]);
    // Another member of the workspace, or another user, sees nothing and can change nothing.
    expect(await otherInWorkspace.findById(mineInWs.id)).toBeUndefined();
    expect(await other.findById(mine.id)).toBeUndefined();
    expect(await other.update(mine.id, { enabled: false })).toBeUndefined();
    expect(await otherInWorkspace.delete(mineInWs.id)).toBe(false);
    // The personal model cannot reach the workspace endpoint either.
    expect(await personal.findById(mineInWs.id)).toBeUndefined();
  });

  it('finds only enabled endpoints that subscribe to the event type', async () => {
    const model = new WebhookEndpointModel(serverDB, userId);
    const subscribed = await model.create(endpointInput());
    await model.create({ ...endpointInput(), events: ['goal.status_changed'] });
    const disabled = await model.create(endpointInput());
    await model.update(disabled.id, { enabled: false });

    const found = await model.findSubscribed('task.status_changed');
    expect(found.map((e) => e.id)).toEqual([subscribed.id]);
  });

  it('records why an endpoint was disabled and clears it on re-enable', async () => {
    const model = new WebhookEndpointModel(serverDB, userId);
    const endpoint = await model.create(endpointInput());

    expect(await model.update(endpoint.id, { enabled: false })).toMatchObject({
      disabledReason: 'manual',
      enabled: false,
    });

    const worker = new WebhookDeliveryWorkerModel(serverDB);
    await model.update(endpoint.id, { enabled: true });
    expect(await worker.markEndpointFailed(endpoint.id, 2)).toBe(false);
    expect(await worker.markEndpointFailed(endpoint.id, 2)).toBe(true);
    expect(await model.findById(endpoint.id)).toMatchObject({
      consecutiveFailures: 2,
      disabledReason: 'consecutive_failures',
      enabled: false,
    });

    expect(await model.update(endpoint.id, { enabled: true })).toMatchObject({
      consecutiveFailures: 0,
      disabledReason: null,
      enabled: true,
    });
  });

  it('keeps an auto-disable reason when an edit leaves `enabled` as it was', async () => {
    const model = new WebhookEndpointModel(serverDB, userId);
    const endpoint = await model.create(endpointInput());
    const worker = new WebhookDeliveryWorkerModel(serverDB);
    await worker.markEndpointFailed(endpoint.id, 1);

    // The settings form always sends `enabled`; saving a new description must not
    // rewrite "disabled after failures" as "disabled by hand".
    expect(
      await model.update(endpoint.id, { description: 'renamed', enabled: false }),
    ).toMatchObject({ disabledReason: 'consecutive_failures', enabled: false });

    // An already enabled endpoint keeps its failure streak on edit.
    await model.update(endpoint.id, { enabled: true });
    await serverDB
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 3 })
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(
      await model.update(endpoint.id, { enabled: true, url: 'https://c.example.com' }),
    ).toMatchObject({
      consecutiveFailures: 3,
      disabledReason: null,
    });
  });

  it('settles queued deliveries when the URL changes, so they never reach the new one', async () => {
    const model = new WebhookEndpointModel(serverDB, userId);
    const endpoint = await model.create(endpointInput());
    const envelope = {
      createdAt: new Date().toISOString(),
      data: { message: 'hi', webhookId: endpoint.id },
      id: 'evt_queued',
      type: 'webhook.test',
      workspaceId: null,
    } as const;
    const queued = await model.createDelivery(endpoint, envelope);
    const delivered = await model.createDelivery(endpoint, { ...envelope, id: 'evt_done' });
    await serverDB
      .update(webhookDeliveries)
      .set({ status: 'succeeded' })
      .where(eq(webhookDeliveries.id, delivered.id));

    // Same URL (or no URL in the patch) leaves the queue alone.
    await model.update(endpoint.id, { description: 'x', url: endpoint.url });
    expect((await model.findDelivery(endpoint.id, queued.id))?.status).toBe('pending');

    await model.update(endpoint.id, { url: 'https://moved.example.com/hook' });
    expect(await model.findDelivery(endpoint.id, queued.id)).toMatchObject({
      error: 'Not sent: the endpoint URL changed',
      status: 'failed',
    });
    expect((await model.findDelivery(endpoint.id, delivered.id))?.status).toBe('succeeded');
  });

  it('lists deliveries of an endpoint newest first, only for its owner', async () => {
    const model = new WebhookEndpointModel(serverDB, userId);
    const endpoint = await model.create(endpointInput());
    const envelope = (id: string) =>
      ({
        createdAt: new Date().toISOString(),
        data: { message: 'hi', webhookId: endpoint.id },
        id,
        type: 'webhook.test',
        workspaceId: null,
      }) as const;
    const first = await model.createDelivery(endpoint, envelope('evt_1'));
    const second = await model.createDelivery(endpoint, envelope('evt_2'), {
      redeliveryOf: first.id,
    });

    const { items, total } = await model.listDeliveries(endpoint.id, { limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(items.map((d) => d.id)).toEqual([second.id, first.id]);
    expect(second).toMatchObject({ attempts: 0, redeliveryOf: first.id, status: 'pending' });
    expect(
      await new WebhookEndpointModel(serverDB, otherUserId).findDelivery(endpoint.id, first.id),
    ).toBeUndefined();
  });
});

describe('WebhookDeliveryWorkerModel', () => {
  const seedDelivery = async () => {
    const endpointModel = new WebhookEndpointModel(serverDB, userId);
    const endpoint = await endpointModel.create(endpointInput());
    const delivery = await endpointModel.createDelivery(endpoint, {
      createdAt: new Date().toISOString(),
      data: { message: 'hi', webhookId: endpoint.id },
      id: 'evt_worker',
      type: 'webhook.test',
      workspaceId: null,
    } as const);
    return { delivery, worker: new WebhookDeliveryWorkerModel(serverDB) };
  };

  const reload = async (deliveryId: string) => {
    const [row] = await serverDB
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    return row;
  };

  it('refuses a duplicate callback that re-reads the attempt the first worker claimed', async () => {
    const { delivery, worker } = await seedDelivery();

    expect(await worker.claimAttempt(delivery.id, 0)).toBe(1);
    const claimed = await reload(delivery.id);
    expect(claimed).toMatchObject({ attempts: 1, status: 'pending' });
    // The claim parks the delivery for one lease, so a duplicate queue message that
    // loaded the bumped counter cannot start a second POST for the same attempt.
    expect(claimed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await worker.claimAttempt(delivery.id, claimed.attempts)).toBeNull();
  });

  it('settles the claimed attempt only, so a stale worker cannot overwrite the outcome', async () => {
    const { delivery, worker } = await seedDelivery();

    expect(await worker.claimAttempt(delivery.id, 0)).toBe(1);
    await worker.recordAttempt(delivery.id, {
      attempts: 1,
      durationMs: 12,
      error: null,
      nextAttemptAt: null,
      responseBody: 'ok',
      responseStatus: 200,
      status: 'succeeded',
    });

    await worker.recordAttempt(delivery.id, {
      attempts: 0,
      durationMs: 12,
      error: 'Delivery failed before sending: boom',
      nextAttemptAt: null,
      responseBody: null,
      responseStatus: null,
      status: 'failed',
    });

    expect(await reload(delivery.id)).toMatchObject({ attempts: 1, status: 'succeeded' });
  });

  it('keeps a delivery canceled while an attempt is in flight', async () => {
    const { delivery, worker } = await seedDelivery();

    expect(await worker.claimAttempt(delivery.id, 0)).toBe(1);
    // A redirect cancels the pending delivery without touching the attempt counter, so the
    // settling CAS still matches on `attempts` alone.
    await serverDB
      .update(webhookDeliveries)
      .set({ error: 'Endpoint destination changed', nextAttemptAt: null, status: 'failed' })
      .where(eq(webhookDeliveries.id, delivery.id));

    expect(
      await worker.recordAttempt(delivery.id, {
        attempts: 1,
        durationMs: 5,
        error: 'HTTP 500',
        nextAttemptAt: new Date(),
        responseBody: null,
        responseStatus: 500,
        status: 'retrying',
      }),
    ).toBe(false);

    expect(await reload(delivery.id)).toMatchObject({
      attempts: 1,
      error: 'Endpoint destination changed',
      status: 'failed',
    });
  });
});

describe('domain events announced by models', () => {
  const capture = () => {
    const listener = vi.fn<DatabaseEventListener>();
    setDatabaseEventListener(listener);
    return listener;
  };

  it('task.status_changed with the previous status, only on a real change', async () => {
    const tasks = new TaskModel(serverDB, userId, workspaceId);
    const task = await tasks.create({ instruction: 'Ship webhooks' });
    const listener = capture();

    await tasks.updateStatus(task.id, 'running');
    await tasks.updateStatus(task.id, 'running');
    await tasks.updateStatusIfCurrent(task.id, 'running', 'completed');

    expect(listener.mock.calls.map(([, scope, type, data]) => [scope, type, data])).toEqual([
      [
        { userId, workspaceId },
        'task.status_changed',
        {
          identifier: task.identifier,
          previousStatus: task.status,
          status: 'running',
          taskId: task.id,
        },
      ],
      [
        { userId, workspaceId },
        'task.status_changed',
        {
          identifier: task.identifier,
          previousStatus: 'running',
          status: 'completed',
          taskId: task.id,
        },
      ],
    ]);
  });

  it('task.status_changed from an actor-logged edit (the status picker)', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const task = await tasks.create({ instruction: 'Picked' });
    const listener = capture();

    await tasks.updateWithLog(task.id, { status: 'running' }, { userId });
    await tasks.updateWithLog(task.id, { description: 'no status change' } as never, { userId });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][3]).toMatchObject({
      previousStatus: task.status,
      status: 'running',
      taskId: task.id,
    });
  });

  it('task.status_changed from deferred completion, CAS batches and bulk updates', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const a = await tasks.create({ instruction: 'A' });
    const b = await tasks.create({ instruction: 'B' });
    await tasks.updateStatus(a.id, 'running');
    await tasks.updateContext(a.id, { completion: { requestedByOperationId: 'op_1' } });
    const listener = capture();

    await tasks.updateStatusIfCurrentForIds([{ id: b.id, status: b.status }], 'paused');
    await tasks.batchUpdateStatus([b.id], 'backlog');

    const transitions = () =>
      listener.mock.calls.map(([, , , data]) => {
        const { previousStatus, status, taskId } = data as Record<string, string>;
        return [taskId, previousStatus, status];
      });
    expect(transitions()).toEqual([
      [b.id, b.status, 'paused'],
      [b.id, 'paused', 'backlog'],
    ]);

    // The deferred completion a run asked for — the path agent-completed tasks take.
    expect(await tasks.completeIfCompletionRequested(a.id, 'op_1')).toMatchObject({
      status: 'completed',
    });
    expect(transitions().at(-1)).toEqual([a.id, 'running', 'completed']);
  });

  it('holds events raised in a transaction until it commits, and drops them on rollback', async () => {
    const db = instrumentDatabaseEvents(serverDB);
    const listener = capture();

    await expect(
      db.transaction(async (tx) => {
        await new TopicModel(tx as never, userId).create({ title: 'rolled back' });
        expect(listener).not.toHaveBeenCalled();
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(listener).not.toHaveBeenCalled();

    await db.transaction(async (tx) => {
      await new TopicModel(tx as never, userId).create({ title: 'committed' });
      expect(listener).not.toHaveBeenCalled();
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][3]).toMatchObject({ title: 'committed' });
  });

  it('topic.created for batch inserts', async () => {
    const listener = capture();
    const rows = await new TopicModel(serverDB, userId).batchInsert([
      { title: 'x' },
      { title: 'y' },
    ]);
    expect(listener.mock.calls.map(([, , type, data]) => [type, (data as any).topicId])).toEqual(
      rows.map((row) => ['topic.created', row.id]),
    );
  });

  it('task.status_changed from a direct update (a report rerun resets the task)', async () => {
    const tasks = new TaskModel(serverDB, userId);
    const task = await tasks.create({ instruction: 'Report' });
    await tasks.updateStatus(task.id, 'completed');
    const listener = capture();

    await tasks.update(task.id, { error: null, instruction: 'Rerun', status: 'backlog' });
    await tasks.update(task.id, { instruction: 'no status in this write' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][3]).toMatchObject({
      previousStatus: 'completed',
      status: 'backlog',
      taskId: task.id,
    });
  });

  it('goal.status_changed when a planning lease starts the goal', async () => {
    const goals = new GoalModel(serverDB, userId);
    const goal = await goals.create({ status: 'planning', title: 'Decompose me' } as never);
    const listener = capture();

    expect(await goals.claimPlanning(goal.id)).toMatchObject({ previousStatus: 'planning' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][3]).toEqual({
      goalId: goal.id,
      previousStatus: 'planning',
      status: 'running',
    });
  });

  it('goal.status_changed once per change, whatever the write path', async () => {
    const goals = new GoalModel(serverDB, userId);
    const goal = await goals.create({ title: 'Paths' });
    const listener = capture();

    await goals.updateStatus(goal.id, 'running');
    await goals.update(goal.id, { status: 'paused' } as never);
    await goals.update(goal.id, { title: 'renamed' });

    expect(listener.mock.calls.map(([, , , data]) => data)).toEqual([
      { goalId: goal.id, previousStatus: goal.status, status: 'running' },
      { goalId: goal.id, previousStatus: 'running', status: 'paused' },
    ]);
  });

  it('goal.status_changed', async () => {
    const goals = new GoalModel(serverDB, userId);
    const goal = await goals.create({ title: 'Public API' });
    const listener = capture();

    await goals.updateStatus(goal.id, 'running');

    expect(listener).toHaveBeenCalledWith(
      serverDB,
      { userId, workspaceId: undefined },
      'goal.status_changed',
      { goalId: goal.id, previousStatus: goal.status, status: 'running' },
    );
  });

  it('message.created and topic.created', async () => {
    const listener = capture();
    const topic = await new TopicModel(serverDB, userId).create({ title: 'Hello' });
    const message = await new MessageModel(serverDB, userId).create({
      content: 'hi',
      role: 'user',
      topicId: topic.id,
    });

    expect(listener.mock.calls.map(([, , type, data]) => [type, data])).toEqual([
      ['topic.created', { agentId: null, title: 'Hello', topicId: topic.id }],
      [
        'message.created',
        { agentId: null, messageId: message.id, role: 'user', threadId: null, topicId: topic.id },
      ],
    ]);
  });

  it('notification.created, but not for a deduplicated insert', async () => {
    const notifications = new NotificationModel(serverDB, userId);
    const listener = capture();
    const input = {
      category: 'system',
      content: 'Body',
      dedupeKey: 'webhook-model-test',
      title: 'Title',
      type: 'test',
    };

    const created = await notifications.create(input as never);
    await notifications.create(input as never);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][2]).toBe('notification.created');
    expect(listener.mock.calls[0][3]).toEqual({
      category: 'system',
      notificationId: created!.id,
      title: 'Title',
      type: 'test',
    });
  });

  it('a throwing listener never fails the write', async () => {
    setDatabaseEventListener(() => {
      throw new Error('boom');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const topic = await new TopicModel(serverDB, userId).create({ title: 'Still saved' });
    expect(topic.id).toBeDefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
